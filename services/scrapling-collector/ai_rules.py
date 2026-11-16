from __future__ import annotations

"""Versioned, bounded AI-assisted collector rules.

The model may propose selectors, but it cannot emit executable code or URLs.
Rules remain drafts until deterministic fixture validation succeeds. The model
endpoint must be an operator-configured HTTPS gateway; the collector firewall
must separately permit that gateway before enabling this feature.
"""

import hashlib
import html
import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.request
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
import uuid
from html.parser import HTMLParser
from urllib.parse import urlparse

DB_PATH = os.environ.get("SCRAPLING_DB_PATH", "/data/collector.sqlite3")
router = APIRouter()
MAX_HTML_BYTES = 256 * 1024
MAX_RULE_BYTES = 16 * 1024
MAX_MODEL_RESPONSE = 32 * 1024
ALLOWED_KINDS = {"media", "player", "pagination", "title"}
SELECTOR_RE = re.compile(r"^(?:[a-zA-Z][a-zA-Z0-9_-]*)?(?:#[a-zA-Z][\w-]*)?(?:\.[a-zA-Z][\w-]*){0,4}$")


def connect():
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def initialize(connection=None):
    own = connection is None
    c = connection or connect()
    try:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS collector_rules (
          host TEXT PRIMARY KEY, active_version INTEGER, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collector_rule_versions (
          id TEXT PRIMARY KEY, host TEXT NOT NULL, version INTEGER NOT NULL,
          status TEXT NOT NULL, rules_json TEXT NOT NULL, source TEXT NOT NULL,
          fixture_passes INTEGER NOT NULL DEFAULT 0, fixture_total INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, UNIQUE(host,version)
        );
        CREATE TABLE IF NOT EXISTS collector_rule_diagnostics (
          id TEXT PRIMARY KEY, host TEXT NOT NULL, task_id TEXT, failure_code TEXT NOT NULL,
          detail_json TEXT NOT NULL, repair_version INTEGER, created_at INTEGER NOT NULL
        );
        """)
        c.commit()
    finally:
        if own:
            c.close()


class _SafeHTMLSample(HTMLParser):
    OMIT = {"script", "style", "noscript", "form", "input", "button", "textarea", "select", "option", "iframe"}
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.skip:
            if tag in self.OMIT and tag not in self.VOID:
                self.skip += 1
            return
        if tag in self.OMIT:
            if tag not in self.VOID:
                self.skip = 1
            return
        safe_attrs = []
        values = dict(attrs)
        for name in ("id", "class"):
            value = values.get(name)
            if value:
                safe_attrs.append(f' {name}="{html.escape(str(value)[:160], quote=True)}"')
        self.parts.append("<" + tag + "".join(safe_attrs) + ">")

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if self.skip or tag in self.OMIT:
            return
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID and not self.skip:
            self.parts.append("</" + tag + ">")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.skip:
            if tag in self.OMIT and tag not in self.VOID:
                self.skip = max(0, self.skip - 1)
            return
        if tag not in self.VOID:
            self.parts.append("</" + tag + ">")

    def handle_data(self, data):
        if not self.skip and data.strip():
            self.parts.append(html.escape(data[:1000]))


def sanitize_html_sample(source: str) -> str:
    parser = _SafeHTMLSample()
    parser.feed(source[:MAX_HTML_BYTES])
    result = "".join(parser.parts)
    return result.encode("utf-8")[:MAX_HTML_BYTES].decode("utf-8", errors="ignore")


def is_configured() -> bool:
    try:
        _model_endpoint()
        return True
    except RuntimeError:
        return False


def validate_rules(value: object) -> dict:
    if not isinstance(value, dict) or set(value) - {"selectors", "notes"}:
        raise ValueError("Rule document must contain only selectors and notes")
    selectors = value.get("selectors")
    if not isinstance(selectors, dict) or not selectors:
        raise ValueError("At least one selector is required")
    cleaned = {}
    for kind, selector in selectors.items():
        if kind not in ALLOWED_KINDS or not isinstance(selector, str):
            raise ValueError("Unsupported selector kind")
        selector = selector.strip()
        if len(selector) > 160 or not SELECTOR_RE.fullmatch(selector):
            raise ValueError("Only simple tag, #id and .class selectors are allowed")
        cleaned[kind] = selector
    notes = value.get("notes", "")
    if not isinstance(notes, str) or len(notes) > 500:
        raise ValueError("Rule notes are too long")
    return {"selectors": cleaned, "notes": notes}


class _FixtureParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.nodes = []

    def handle_starttag(self, tag, attrs):
        self.nodes.append((tag.lower(), dict(attrs)))


def _matches(node, selector):
    tag, attrs = node
    tag_match = re.match(r"^[a-zA-Z][a-zA-Z0-9_-]*", selector)
    if tag_match and tag != tag_match.group(0).lower():
        return False
    ident = re.search(r"#([\w-]+)", selector)
    if ident and attrs.get("id") != ident.group(1):
        return False
    classes = re.findall(r"\.([\w-]+)", selector)
    existing = set((attrs.get("class") or "").split())
    return all(item in existing for item in classes)


def validate_fixtures(rules: dict, fixtures: list[str]) -> tuple[int, int]:
    rules = validate_rules(rules)
    total = min(len(fixtures), 20)
    passed = 0
    for source in fixtures[:20]:
        if not isinstance(source, str) or len(source.encode("utf-8")) > MAX_HTML_BYTES:
            continue
        parser = _FixtureParser()
        parser.feed(source)
        if any(any(_matches(node, selector) for node in parser.nodes)
               for selector in rules["selectors"].values()):
            passed += 1
    return passed, total


def _model_endpoint() -> tuple[str, str, str]:
    endpoint = os.environ.get("COLLECTOR_AI_GATEWAY_URL", "").strip()
    api_key = os.environ.get("COLLECTOR_AI_API_KEY", "").strip()
    model = os.environ.get("COLLECTOR_AI_MODEL", "").strip()
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise RuntimeError("COLLECTOR_AI_GATEWAY_URL must be an operator-configured HTTPS gateway")
    allowed = {item.strip().lower() for item in os.environ.get("COLLECTOR_AI_ALLOWED_HOSTS", "").split(",") if item.strip()}
    if parsed.hostname.lower() not in allowed:
        raise RuntimeError("AI gateway host is not in COLLECTOR_AI_ALLOWED_HOSTS")
    if not api_key or not model:
        raise RuntimeError("AI gateway key and model are not configured")
    return endpoint.rstrip("/") + "/v1/chat/completions", api_key, model


def generate_rules(host: str, page_html: str, diagnostics: dict | None = None) -> dict:
    if len(page_html.encode("utf-8")) > MAX_HTML_BYTES:
        raise ValueError("Page sample exceeds the bounded analysis size")
    endpoint, key, model = _model_endpoint()
    prompt = {
        "host": host,
        "html_sample": sanitize_html_sample(page_html),
        "diagnostics": diagnostics or {},
        "contract": {
            "selectors": {kind: "one simple CSS selector" for kind in sorted(ALLOWED_KINDS)},
            "notes": "brief explanation",
            "forbidden": ["javascript", "xpath", "URLs", "credentials", "network actions", "code"],
        },
    }
    body = json.dumps({
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "Generate conservative CSS extraction selectors. Return JSON only. Never infer access permission or bypass controls."},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
    }).encode("utf-8")
    request = urllib.request.Request(endpoint, data=body, headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }, method="POST")
    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=12) as response:
            if response.status != 200:
                raise RuntimeError("AI gateway returned a non-success status")
            raw = response.read(MAX_MODEL_RESPONSE + 1)
    except (urllib.error.URLError, TimeoutError, urllib.error.HTTPError) as exc:
        raise RuntimeError("AI gateway request failed") from exc
    if len(raw) > MAX_MODEL_RESPONSE:
        raise ValueError("AI gateway response exceeded limit")
    envelope = json.loads(raw)
    content = envelope["choices"][0]["message"]["content"]
    if not isinstance(content, str) or len(content.encode("utf-8")) > MAX_RULE_BYTES:
        raise ValueError("AI gateway returned an invalid rule payload")
    return validate_rules(json.loads(content))


def save_version(host: str, rules: dict, source: str, fixtures: list[str] | None = None) -> dict:
    rules = validate_rules(rules)
    passed, total = validate_fixtures(rules, fixtures or [])
    status = "active" if total > 0 and passed > 0 else "draft"
    now = int(time.time())
    version_id = uuid.uuid4().hex
    with connect() as c:
        initialize(c)
        c.execute("BEGIN IMMEDIATE")
        current = c.execute("SELECT COALESCE(MAX(version),0) AS version FROM collector_rule_versions WHERE host=?", (host,)).fetchone()["version"]
        version = current + 1
        c.execute("""INSERT INTO collector_rule_versions
          (id,host,version,status,rules_json,source,fixture_passes,fixture_total,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)""",
          (version_id, host, version, status, json.dumps(rules, ensure_ascii=False), source, passed, total, now))
        c.execute("""INSERT INTO collector_rules(host,active_version,updated_at) VALUES(?,?,?)
          ON CONFLICT(host) DO UPDATE SET active_version=CASE WHEN excluded.active_version IS NOT NULL
          THEN excluded.active_version ELSE collector_rules.active_version END, updated_at=excluded.updated_at""",
          (host, version if status == "active" else None, now))
        c.commit()
    return {"id": version_id, "host": host, "version": version, "status": status,
            "fixture_passes": passed, "fixture_total": total, "rules": rules}


def record_failure(host: str, task_id: str | None, failure_code: str, detail: dict | None = None) -> str:
    safe_code = re.sub(r"[^a-zA-Z0-9_.-]", "_", failure_code)[:80]
    identifier = uuid.uuid4().hex
    with connect() as c:
        initialize(c)
        c.execute("""INSERT INTO collector_rule_diagnostics
          (id,host,task_id,failure_code,detail_json,created_at) VALUES(?,?,?,?,?,?)""",
          (identifier, host, task_id, safe_code, json.dumps(detail or {}, ensure_ascii=False)[:4000], int(time.time())))
        c.commit()
    return identifier


def diagnose_and_repair(host: str, page_html: str, failure_code: str,
                        task_id: str | None = None, fixtures: list[str] | None = None) -> dict:
    diagnostic_id = record_failure(host, task_id, failure_code)
    proposal = generate_rules(host, page_html, {"failure_code": failure_code})
    version = save_version(host, proposal, "ai_repair", fixtures or [])
    with connect() as c:
        c.execute("UPDATE collector_rule_diagnostics SET repair_version=? WHERE id=?",
                  (version["version"], diagnostic_id))
        c.commit()
    return {"diagnostic_id": diagnostic_id, "repair": version}


def get_active_rule(host: str) -> dict | None:
    with connect() as c:
        initialize(c)
        row = c.execute("""SELECT v.* FROM collector_rules r
          JOIN collector_rule_versions v ON v.host=r.host AND v.version=r.active_version
          WHERE r.host=?""", (host,)).fetchone()
    if not row:
        return None
    return {"host": host, "version": row["version"], "rules": json.loads(row["rules_json"]),
            "status": row["status"], "fixture_passes": row["fixture_passes"],
            "fixture_total": row["fixture_total"]}


class RuleJobRequest(BaseModel):
    host: str = Field(min_length=1, max_length=253)
    page_html: str = Field(min_length=1, max_length=MAX_HTML_BYTES)
    fixtures: list[str] = Field(default_factory=list, max_length=20)
    task_id: str | None = Field(default=None, max_length=80)
    failure_code: str | None = Field(default=None, max_length=80)


def _validate_host(host: str) -> str:
    host = host.strip().rstrip(".").lower()
    if not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*", host):
        raise HTTPException(status_code=400, detail="A canonical DNS hostname is required")
    return host


def _enqueue_rule_job(job_type: str, request: RuleJobRequest, authorization: str | None):
    from registry_queue import require_auth, submit_job
    require_auth(authorization)
    host = _validate_host(request.host)
    fixtures = []
    for fixture in request.fixtures:
        if len(fixture.encode("utf-8")) > MAX_HTML_BYTES:
            raise HTTPException(status_code=413, detail="Fixture exceeds the bounded sample size")
        fixtures.append(fixture)
    payload = {
        "host": host, "page_html": request.page_html,
        "fixtures": fixtures, "task_id": request.task_id,
        "failure_code": request.failure_code or "selector_miss",
    }
    key = "ai-rule:" + job_type + ":" + hashlib.sha256(
        (host + "|" + (request.task_id or "") + "|" + hashlib.sha256(request.page_html.encode()).hexdigest()).encode()
    ).hexdigest()
    try:
        return submit_job(job_type, payload, key, max_attempts=2)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/v1/rules/generate")
def enqueue_rule_generation(request: RuleJobRequest, authorization: str | None = Header(default=None)):
    job = _enqueue_rule_job("rule_generate", request, authorization)
    return {"job_id": job["id"], "status": job["status"], "host": request.host}


@router.post("/v1/rules/repair")
def enqueue_rule_repair(request: RuleJobRequest, authorization: str | None = Header(default=None)):
    job = _enqueue_rule_job("rule_repair", request, authorization)
    return {"job_id": job["id"], "status": job["status"], "host": request.host}


@router.get("/v1/rules/{host}")
def read_active_rule(host: str, authorization: str | None = Header(default=None)):
    from registry_queue import require_auth
    require_auth(authorization)
    rule = get_active_rule(_validate_host(host))
    if rule is None:
        raise HTTPException(status_code=404, detail="No fixture-validated active rule")
    return rule
