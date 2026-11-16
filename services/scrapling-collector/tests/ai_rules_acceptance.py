#!/usr/bin/env python3
"""Live AI rule generation/repair against an operator-approved public HTML page."""
from __future__ import annotations

import json
import os
import time
import uuid
import urllib.request

from app import Fetcher, public_https_url, require_egress_firewall
import ai_rules

BASE = os.environ.get("SCRAPLING_API_BASE", "http://127.0.0.1:8000").rstrip("/")
TOKEN = os.environ["SCRAPLING_API_TOKEN"]
TARGET_URL = os.environ["AI_RULE_ACCEPTANCE_URL"].strip()
MAX_SAMPLE_BYTES = 128 * 1024


def fetch_real_sample() -> tuple[str, str]:
    require_egress_firewall()
    _, host = public_https_url(TARGET_URL)
    allowed = {
        item.strip().lower().rstrip(".")
        for item in os.environ.get("COLLECTOR_AI_ALLOWED_HOSTS", "").split(",")
        if item.strip()
    }
    if host not in allowed:
        raise SystemExit("FAIL: AI acceptance target host is not in COLLECTOR_AI_ALLOWED_HOSTS")

    # Use the Collector's normal fetcher, not a separate raw HTTP client.
    page = Fetcher.get(TARGET_URL, timeout=25, follow_redirects="safe")
    status = int(getattr(page, "status", 0) or 0)
    final_url = str(getattr(page, "url", TARGET_URL) or TARGET_URL)
    _, final_host = public_https_url(final_url)
    if final_host != host:
        raise SystemExit("FAIL: AI acceptance fetch redirected outside its approved hostname")
    if not 200 <= status < 300:
        raise SystemExit(f"FAIL: approved HTML page returned HTTP {status}")
    content_type = str((getattr(page, "headers", {}) or {}).get("content-type", "")).lower()
    if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
        raise SystemExit("FAIL: AI acceptance target did not return an HTML content type")
    body = getattr(page, "body", b"") or b""
    if isinstance(body, str):
        body = body.encode("utf-8")
    sample = ai_rules.sanitize_html_sample(body[:MAX_SAMPLE_BYTES].decode("utf-8", errors="replace"))
    if len(sample.encode("utf-8")) < 128:
        raise SystemExit("FAIL: fetched page did not contain a sufficiently useful sanitized HTML sample")
    return host, sample


def request(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read(1024 * 1024))


def wait_job(job_id):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        job = request("/v1/jobs/" + job_id)
        if job.get("status") in {"succeeded", "partial", "failed", "cancelled"}:
            if job.get("status") != "succeeded":
                raise SystemExit("FAIL: AI rule job did not succeed")
            return job
        time.sleep(2)
    raise SystemExit("FAIL: AI rule job timed out")


def enqueue(path, host, sample, failure_code=None, task_id=None):
    payload = {
        "host": host,
        "page_html": sample,
        "fixtures": [sample],
        "task_id": task_id,
    }
    if failure_code:
        payload["failure_code"] = failure_code
    result = request(path, "POST", payload)
    return wait_job(result["job_id"])


def main():
    host, sample = fetch_real_sample()
    task_id = "live-ai-acceptance-" + uuid.uuid4().hex
    generated = enqueue("/v1/rules/generate", host, sample, task_id=task_id)
    active = request("/v1/rules/" + host)
    if active.get("status") != "active" or active.get("fixture_passes", 0) < 1:
        raise SystemExit("FAIL: generated selector did not pass the real-page HTML fixture")
    previous_version = int(active["version"])

    repaired = enqueue(
        "/v1/rules/repair", host, sample, "live_acceptance_repair", task_id
    )
    active_after = request("/v1/rules/" + host)
    repaired_version = int(active_after["version"])
    if repaired_version <= previous_version or active_after.get("status") != "active":
        raise SystemExit("FAIL: repaired rule was not versioned and fixture-validated")

    history = request("/v1/rules/" + host + "/versions")["versions"]
    if not any(item["version"] == previous_version for item in history):
        raise SystemExit("FAIL: initial rule version is missing from history")
    if not any(item["version"] == repaired_version and item["is_active"] for item in history):
        raise SystemExit("FAIL: active rule pointer is missing from version history")
    diagnostics = request("/v1/rules/" + host + "/diagnostics")["diagnostics"]
    if not any(item.get("repair_version") == repaired_version for item in diagnostics):
        raise SystemExit("FAIL: repair diagnostic was not linked to its rule version")

    rolled_back = request(
        "/v1/rules/" + host + f"/versions/{previous_version}/activate", "POST"
    )
    if int(rolled_back["version"]) != previous_version:
        raise SystemExit("FAIL: validated rollback did not restore the previous version")
    restored = request(
        "/v1/rules/" + host + f"/versions/{repaired_version}/activate", "POST"
    )
    audit = request("/v1/rules/" + host + "/events")["events"]
    if not any(
        item.get("action") == "rollback"
        and item.get("version") == previous_version
        and item.get("previous_version") == repaired_version
        for item in audit
    ):
        raise SystemExit("FAIL: rollback audit event was not recorded")
    if int(restored["version"]) != repaired_version:
        raise SystemExit("FAIL: repaired version could not be reactivated after rollback")

    print(json.dumps({
        "status": "passed",
        "source_host": host,
        "source_type": "operator-approved-live-public-html",
        "sample_bytes": len(sample.encode("utf-8")),
        "generation_job": generated.get("id"),
        "repair_job": repaired.get("id"),
        "initial_version": previous_version,
        "repaired_version": repaired_version,
        "history_versions": len(history),
        "diagnostics": len(diagnostics),
        "rollback_verified": True,
        "fixture_passes": active_after["fixture_passes"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
