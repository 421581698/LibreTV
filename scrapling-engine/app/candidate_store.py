from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row

from app.security import UnsafeTargetError, validate_public_http_url


def _now() -> datetime:
    return datetime.now(UTC)


def _canonical_url(value: str) -> str:
    parts = urlsplit(value)
    return urlunsplit(
        (parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", parts.query, "")
    )


class PostgresCandidateStore:
    """Evidence-backed resource candidates; deliberately has no publish operation."""

    def __init__(self, database_url: str) -> None:
        if not database_url.startswith(("postgres://", "postgresql://")):
            raise ValueError("DATABASE_URL must use PostgreSQL")
        self.database_url = database_url

    def initialize(self) -> None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS resource_candidates (
                    candidate_id TEXT PRIMARY KEY,
                    source_url TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    media_url TEXT,
                    media_type TEXT,
                    quality_json JSONB,
                    status TEXT NOT NULL DEFAULT 'pending_review',
                    discovery_workflow_id TEXT,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                )
                """
            )
            db.execute(
                "ALTER TABLE resource_candidates ADD COLUMN IF NOT EXISTS quality_json JSONB"
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS resource_candidate_evidence (
                    evidence_id BIGSERIAL PRIMARY KEY,
                    candidate_id TEXT NOT NULL REFERENCES resource_candidates(candidate_id)
                        ON DELETE CASCADE,
                    evidence_type TEXT NOT NULL,
                    evidence_json JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL
                )
                """
            )
            db.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_resource_candidates_status_updated
                ON resource_candidates(status, updated_at DESC)
                """
            )
            db.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_candidate_evidence_candidate_id
                ON resource_candidate_evidence(candidate_id, evidence_id)
                """
            )

    def ingest_crawl_items(
        self,
        workflow_id: str,
        items: list[dict[str, Any]],
    ) -> list[str]:
        candidate_ids: list[str] = []
        now = _now()
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            for item in items:
                page_url = item.get("url")
                if not isinstance(page_url, str):
                    continue
                try:
                    page_url = _canonical_url(validate_public_http_url(page_url))
                except UnsafeTargetError:
                    continue
                media_urls = item.get("media_urls")
                if not isinstance(media_urls, list):
                    media_urls = [item.get("media_url")]
                title = str(item.get("title") or page_url)[:300]
                for raw_media_url in media_urls[:20]:
                    if not isinstance(raw_media_url, str):
                        continue
                    try:
                        media_url = _canonical_url(
                            validate_public_http_url(raw_media_url)
                        )
                    except UnsafeTargetError:
                        continue
                    candidate_id = hashlib.sha256(
                        media_url.encode("utf-8")
                    ).hexdigest()[:24]
                    media_type = (
                        "hls" if ".m3u8" in urlsplit(media_url).path.lower()
                        else "dash" if ".mpd" in urlsplit(media_url).path.lower()
                        else "file"
                    )
                    row = db.execute(
                        """
                        INSERT INTO resource_candidates
                            (candidate_id, source_url, title, media_url, media_type,
                             status, discovery_workflow_id, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, 'pending_review', %s, %s, %s)
                        ON CONFLICT (source_url) DO UPDATE
                        SET title = CASE
                                WHEN resource_candidates.title = resource_candidates.source_url
                                THEN EXCLUDED.title ELSE resource_candidates.title END,
                            media_url = COALESCE(resource_candidates.media_url, EXCLUDED.media_url),
                            media_type = COALESCE(
                                resource_candidates.media_type, EXCLUDED.media_type
                            ),
                            updated_at = EXCLUDED.updated_at
                        RETURNING candidate_id
                        """,
                        (
                            candidate_id,
                            media_url,
                            title,
                            media_url,
                            media_type,
                            workflow_id,
                            now,
                            now,
                        ),
                    ).fetchone()
                    if row is None:
                        continue
                    stored_id = row["candidate_id"]
                    candidate_ids.append(stored_id)
                    evidence = {
                        "workflow_id": workflow_id,
                        "page_url": page_url,
                        "media_url": media_url,
                        "http_status": item.get("status"),
                        "title": item.get("title"),
                        "text_excerpt": str(item.get("text") or "")[:1500],
                        "media_type": media_type,
                    }
                    db.execute(
                        """
                        INSERT INTO resource_candidate_evidence
                            (candidate_id, evidence_type, evidence_json, created_at)
                        VALUES (%s, 'scrapling_media_reference', %s::jsonb, %s)
                        """,
                        (
                            stored_id,
                            json.dumps(evidence, ensure_ascii=False),
                            now,
                        ),
                    )
        return candidate_ids

    def save_quality_report(
        self,
        candidate_id: str,
        report: dict[str, Any],
    ) -> bool:
        now = _now()
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            cursor = db.execute(
                """
                UPDATE resource_candidates
                SET quality_json = %s::jsonb, updated_at = %s
                WHERE candidate_id = %s
                """,
                (json.dumps(report, ensure_ascii=False), now, candidate_id),
            )
            if cursor.rowcount != 1:
                return False
            db.execute(
                """
                INSERT INTO resource_candidate_evidence
                    (candidate_id, evidence_type, evidence_json, created_at)
                VALUES (%s, 'media_quality_analysis', %s::jsonb, %s)
                """,
                (
                    candidate_id,
                    json.dumps(report, ensure_ascii=False),
                    now,
                ),
            )
            return True

    def review_candidate(
        self,
        candidate_id: str,
        decision: str,
        reviewer_id: str,
        note: str = "",
    ) -> bool:
        if decision not in {"approved", "rejected"}:
            raise ValueError("Candidate decision must be approved or rejected")
        if not reviewer_id.strip():
            raise ValueError("A reviewer identity is required")
        now = _now()
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            cursor = db.execute(
                """
                UPDATE resource_candidates
                SET status = %s, updated_at = %s
                WHERE candidate_id = %s AND status = 'pending_review'
                """,
                (decision, now, candidate_id),
            )
            if cursor.rowcount != 1:
                return False
            evidence = {
                "decision": decision,
                "reviewer_id": reviewer_id[:128],
                "note": note[:1000],
                "reviewed_at": now.isoformat(),
            }
            db.execute(
                """
                INSERT INTO resource_candidate_evidence
                    (candidate_id, evidence_type, evidence_json, created_at)
                VALUES (%s, 'human_review', %s::jsonb, %s)
                """,
                (
                    candidate_id,
                    json.dumps(evidence, ensure_ascii=False),
                    now,
                ),
            )
            return True

    def list_candidates(
        self,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        safe_limit = min(max(limit, 1), 200)
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            if status:
                rows = db.execute(
                    """
                    SELECT * FROM resource_candidates
                    WHERE status = %s ORDER BY updated_at DESC LIMIT %s
                    """,
                    (status, safe_limit),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM resource_candidates "
                    "ORDER BY updated_at DESC LIMIT %s",
                    (safe_limit,),
                ).fetchall()
        return [dict(row) for row in rows]

    def get_candidate(self, candidate_id: str) -> dict[str, Any] | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as db:
            candidate = db.execute(
                "SELECT * FROM resource_candidates WHERE candidate_id = %s",
                (candidate_id,),
            ).fetchone()
            if candidate is None:
                return None
            evidence = db.execute(
                """
                SELECT evidence_id, evidence_type, evidence_json, created_at
                FROM resource_candidate_evidence
                WHERE candidate_id = %s ORDER BY evidence_id
                """,
                (candidate_id,),
            ).fetchall()
        result = dict(candidate)
        result["evidence"] = [
            {
                "evidence_id": row["evidence_id"],
                "type": row["evidence_type"],
                "data": row["evidence_json"],
                "created_at": row["created_at"],
            }
            for row in evidence
        ]
        return result
