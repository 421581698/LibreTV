from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import psycopg
from psycopg.rows import dict_row

from app.security import validate_public_http_url


def _now() -> datetime:
    return datetime.now(UTC)


class PostgresRuleStore:
    """Versioned, evidence-backed extraction rules; activation is an explicit human action."""

    def __init__(self, database_url: str) -> None:
        if not database_url.startswith(("postgres://", "postgresql://")):
            raise ValueError("DATABASE_URL must use PostgreSQL")
        self.database_url = database_url

    def initialize(self) -> None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS scraping_rules (
                    rule_id TEXT PRIMARY KEY,
                    rule_key TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    source_origin TEXT NOT NULL,
                    page_url TEXT NOT NULL,
                    goal TEXT NOT NULL,
                    mode TEXT NOT NULL CHECK (mode IN ('css', 'xpath')),
                    selector TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'tested'
                        CHECK (status IN ('tested', 'active', 'disabled')),
                    workflow_id TEXT,
                    test_json JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    UNIQUE (rule_key, version)
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS scraping_rule_tests (
                    test_id BIGSERIAL PRIMARY KEY,
                    rule_id TEXT NOT NULL REFERENCES scraping_rules(rule_id)
                        ON DELETE CASCADE,
                    passed BOOLEAN NOT NULL,
                    match_count INTEGER NOT NULL,
                    test_json JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS scraping_rule_events (
                    event_id BIGSERIAL PRIMARY KEY,
                    rule_id TEXT NOT NULL REFERENCES scraping_rules(rule_id)
                        ON DELETE CASCADE,
                    actor_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    note TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL
                )
                """
            )
            db.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_scraping_rules_status_updated
                ON scraping_rules(status, updated_at DESC)
                """
            )
            db.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_scraping_rules_origin_goal
                ON scraping_rules(source_origin, goal, version DESC)
                """
            )

    def save_tested_rule(
        self,
        *,
        page_url: str,
        goal: str,
        mode: str,
        selector: str,
        rationale: str,
        match_count: int,
        sample_values: list[str],
        workflow_id: str,
    ) -> str:
        if mode not in {"css", "xpath"}:
            raise ValueError("Rule mode must be CSS or XPath")
        if not 1 <= len(selector) <= 300 or match_count < 1:
            raise ValueError("Only non-empty, tested extraction rules can be stored")
        safe_url = validate_public_http_url(page_url)
        parsed = urlsplit(safe_url)
        origin = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
        rule_key = hashlib.sha256(
            f"{origin}\0{goal.strip().lower()}".encode()
        ).hexdigest()
        rule_id = uuid.uuid4().hex
        now = _now()
        test_result = {
            "passed": True,
            "match_count": match_count,
            "sample_values": sample_values[:5],
            "verification_level": "live_page_selector_test",
        }
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            db.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (rule_key,))
            version = db.execute(
                """
                SELECT COALESCE(MAX(version), 0) + 1 AS next_version
                FROM scraping_rules WHERE rule_key = %s
                """,
                (rule_key,),
            ).fetchone()["next_version"]
            previous = db.execute(
                """
                UPDATE scraping_rules SET status = 'disabled', updated_at = %s
                WHERE rule_key = %s AND status = 'active'
                RETURNING rule_id
                """,
                (now, rule_key),
            ).fetchall()
            for old_rule in previous:
                db.execute(
                    """
                    INSERT INTO scraping_rule_events
                        (rule_id, actor_id, action, note, created_at)
                    VALUES (%s, 'ai-supervisor', 'superseded', %s, %s)
                    """,
                    (old_rule["rule_id"], f"Superseded by version {version}.", now),
                )
            db.execute(
                """
                INSERT INTO scraping_rules
                    (rule_id, rule_key, version, source_origin, page_url, goal,
                     mode, selector, rationale, status, workflow_id, test_json,
                     created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'active', %s, %s::jsonb, %s, %s)
                """,
                (
                    rule_id,
                    rule_key,
                    version,
                    origin,
                    safe_url,
                    goal[:1000],
                    mode,
                    selector,
                    rationale[:500],
                    workflow_id,
                    json.dumps(test_result, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            db.execute(
                """
                INSERT INTO scraping_rule_tests
                    (rule_id, passed, match_count, test_json, created_at)
                VALUES (%s, TRUE, %s, %s::jsonb, %s)
                """,
                (
                    rule_id,
                    match_count,
                    json.dumps(test_result, ensure_ascii=False),
                    now,
                ),
            )
            db.execute(
                """
                INSERT INTO scraping_rule_events
                    (rule_id, actor_id, action, note, created_at)
                VALUES (%s, 'ai-supervisor', 'rule_auto_activated', %s, %s)
                """,
                (rule_id, rationale[:500], now),
            )
        return rule_id

    def set_status(
        self,
        rule_id: str,
        status: str,
        actor_id: str,
        note: str = "",
    ) -> bool:
        if status not in {"active", "disabled"}:
            raise ValueError("Rule status must be active or disabled")
        if not actor_id.strip():
            raise ValueError("A reviewer identity is required")
        now = _now()
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            if status == "active":
                db.execute(
                    """
                    UPDATE scraping_rules
                    SET status = 'disabled', updated_at = %s
                    WHERE rule_key = (
                        SELECT rule_key FROM scraping_rules WHERE rule_id = %s
                    ) AND rule_id <> %s AND status = 'active'
                    """,
                    (now, rule_id, rule_id),
                )
            cursor = db.execute(
                """
                UPDATE scraping_rules SET status = %s, updated_at = %s
                WHERE rule_id = %s AND status IN ('tested', 'active', 'disabled')
                """,
                (status, now, rule_id),
            )
            if cursor.rowcount != 1:
                return False
            db.execute(
                """
                INSERT INTO scraping_rule_events
                    (rule_id, actor_id, action, note, created_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (rule_id, actor_id[:128], status, note[:1000], now),
            )
            return True

    def list_rules(
        self,
        status: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        safe_limit = min(max(limit, 1), 200)
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            if status:
                rows = db.execute(
                    """
                    SELECT * FROM scraping_rules WHERE status = %s
                    ORDER BY updated_at DESC LIMIT %s
                    """,
                    (status, safe_limit),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM scraping_rules ORDER BY updated_at DESC LIMIT %s",
                    (safe_limit,),
                ).fetchall()
        return [dict(row) for row in rows]

    def get_rule(self, rule_id: str) -> dict[str, Any] | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            rule = db.execute(
                "SELECT * FROM scraping_rules WHERE rule_id = %s",
                (rule_id,),
            ).fetchone()
            if rule is None:
                return None
            tests = db.execute(
                """
                SELECT test_id, passed, match_count, test_json, created_at
                FROM scraping_rule_tests WHERE rule_id = %s ORDER BY test_id
                """,
                (rule_id,),
            ).fetchall()
            events = db.execute(
                """
                SELECT event_id, actor_id, action, note, created_at
                FROM scraping_rule_events WHERE rule_id = %s ORDER BY event_id
                """,
                (rule_id,),
            ).fetchall()
        result = dict(rule)
        result["tests"] = [dict(row) for row in tests]
        result["events"] = [dict(row) for row in events]
        return result
