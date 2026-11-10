"""SQLite-backed resource registry and durable crawl queue.

The registry intentionally identifies a resource by source + canonical URL, never
by title alone. Access and playback states are separate; only explicit browser
playback evidence can set PLAYER_CONFIRMED.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

DB_PATH = Path(os.environ.get("SCRAPLING_DB_PATH", "/data/collector.sqlite3"))
TERMINAL = {"succeeded", "partial", "failed", "cancelled"}


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def safe_url(raw: str) -> str:
    parts = urlsplit(raw)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("Only credential-free HTTPS resource URLs are accepted")
    # Query strings can carry expiring tokens; do not persist them in the registry.
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", "", ""))


def init() -> None:
    with connect() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS registry_sources (
          id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS registry_movies (
          id TEXT PRIMARY KEY, external_id TEXT, title TEXT NOT NULL,
          year INTEGER, metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
          UNIQUE(external_id)
        );
        CREATE TABLE IF NOT EXISTS registry_episodes (
          id TEXT PRIMARY KEY, movie_id TEXT NOT NULL REFERENCES registry_movies(id),
          season INTEGER, episode INTEGER, title TEXT NOT NULL DEFAULT '',
          UNIQUE(movie_id, season, episode)
        );
        CREATE TABLE IF NOT EXISTS registry_resources (
          id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES registry_sources(id),
          movie_id TEXT REFERENCES registry_movies(id),
          episode_id TEXT REFERENCES registry_episodes(id),
          canonical_url TEXT NOT NULL, resource_type TEXT NOT NULL,
          access_state TEXT NOT NULL DEFAULT 'ACCESS_UNKNOWN',
          validation_state TEXT NOT NULL DEFAULT 'unverified',
          playback_state TEXT NOT NULL DEFAULT 'NOT_TESTED',
          media_type TEXT, metadata TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE(source_id, canonical_url)
        );
        CREATE INDEX IF NOT EXISTS idx_registry_resources_movie
          ON registry_resources(movie_id, episode_id);
        CREATE TABLE IF NOT EXISTS registry_verifications (
          id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES registry_resources(id),
          kind TEXT NOT NULL, outcome TEXT NOT NULL, evidence TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS registry_history (
          id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES registry_resources(id),
          event TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collector_jobs (
          id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
          url TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
          attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 4,
          available_at INTEGER NOT NULL, lease_owner TEXT, lease_until INTEGER,
          checkpoint TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}',
          error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_collector_jobs_claim
          ON collector_jobs(status, available_at, lease_until);
        """)


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def enqueue(url: str, mode: str = "auto", idempotency_key: str | None = None) -> dict:
    canonical = safe_url(url)
    if mode not in {"auto", "http", "browser"}:
        raise ValueError("Invalid crawl mode")
    now = int(time.time())
    key = idempotency_key or hashlib.sha256(f"{canonical}|{mode}".encode()).hexdigest()
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        c.execute("""INSERT OR IGNORE INTO collector_jobs
          (id,idempotency_key,url,mode,status,available_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?)""",
          (uuid.uuid4().hex, key, canonical, mode, "queued", now, now, now))
        row = c.execute("SELECT * FROM collector_jobs WHERE idempotency_key=?", (key,)).fetchone()
        c.commit()
    return dict(row)


def claim(worker_id: str, lease_seconds: int = 120) -> dict | None:
    now = int(time.time())
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        # Recover expired leases; preserve attempts and schedule bounded retry.
        c.execute("""UPDATE collector_jobs SET status='queued', lease_owner=NULL,
          lease_until=NULL, available_at=?, updated_at=?
          WHERE status='running' AND lease_until < ? AND attempts < max_attempts""",
          (now, now, now))
        c.execute("""UPDATE collector_jobs SET status='failed', error='lease_expired_max_attempts',
          lease_owner=NULL, lease_until=NULL, updated_at=?
          WHERE status='running' AND lease_until < ? AND attempts >= max_attempts""", (now, now))
        row = c.execute("""SELECT * FROM collector_jobs
          WHERE status='queued' AND available_at <= ? ORDER BY created_at LIMIT 1""", (now,)).fetchone()
        if row is None:
            c.commit()
            return None
        changed = c.execute("""UPDATE collector_jobs SET status='running', attempts=attempts+1,
          lease_owner=?, lease_until=?, updated_at=? WHERE id=? AND status='queued'""",
          (worker_id, now + max(15, min(lease_seconds, 900)), now, row["id"])).rowcount
        c.commit()
        if not changed:
            return None
        return dict(c.execute("SELECT * FROM collector_jobs WHERE id=?", (row["id"],)).fetchone())


def finish(job_id: str, worker_id: str, status: str, result: dict | None = None,
           error: str | None = None) -> dict:
    if status not in {"succeeded", "partial", "failed"}:
        raise ValueError("Invalid terminal job status")
    now = int(time.time())
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT * FROM collector_jobs WHERE id=?", (job_id,)).fetchone()
        if row is None:
            c.rollback()
            raise KeyError("Job not found")
        if row["status"] != "running" or row["lease_owner"] != worker_id:
            c.rollback()
            raise PermissionError("Worker does not own the active job lease")
        retry = status == "failed" and row["attempts"] < row["max_attempts"]
        next_status = "queued" if retry else status
        delay = min(3600, 15 * (2 ** max(0, row["attempts"] - 1))) if retry else 0
        c.execute("""UPDATE collector_jobs SET status=?, available_at=?, lease_owner=NULL,
          lease_until=NULL, result=?, error=?, updated_at=? WHERE id=?""",
          (next_status, now + delay, _json(result or {}), (error or "")[:300] or None,
           now, job_id))
        updated = dict(c.execute("SELECT * FROM collector_jobs WHERE id=?", (job_id,)).fetchone())
        c.commit()
    return updated


def cancel(job_id: str) -> dict | None:
    now = int(time.time())
    with connect() as c:
        c.execute("""UPDATE collector_jobs SET status='cancelled', lease_owner=NULL,
          lease_until=NULL, updated_at=? WHERE id=? AND status IN ('queued','running')""", (now, job_id))
        row = c.execute("SELECT * FROM collector_jobs WHERE id=?", (job_id,)).fetchone()
        return dict(row) if row else None


def get_job(job_id: str) -> dict | None:
    with connect() as c:
        row = c.execute("SELECT * FROM collector_jobs WHERE id=?", (job_id,)).fetchone()
        return dict(row) if row else None


def upsert_resource(source_key: str, source_name: str, url: str, resource_type: str,
                    title: str = "", external_id: str | None = None,
                    access_state: str = "ACCESS_UNKNOWN", validation_state: str = "unverified",
                    media_type: str | None = None, metadata: dict | None = None) -> dict:
    if resource_type not in {"CMS_VOD", "DIRECT_MEDIA", "EMBEDDED_PLAYER"}:
        raise ValueError("Invalid resource type")
    if access_state not in {"PUBLIC", "AUTH_REQUIRED", "SUBSCRIPTION_REQUIRED",
                            "CHALLENGE", "DRM_PROTECTED", "ENCRYPTED_STREAM", "ACCESS_UNKNOWN"}:
        raise ValueError("Invalid access state")
    canonical = safe_url(url)
    now = int(time.time())
    source_id = hashlib.sha256(source_key.encode()).hexdigest()[:32]
    resource_id = hashlib.sha256(f"{source_id}|{canonical}".encode()).hexdigest()[:32]
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        c.execute("""INSERT OR IGNORE INTO registry_sources(id,source_key,name,created_at)
          VALUES(?,?,?,?)""", (source_id, source_key[:120], source_name[:120], now))
        movie_id = None
        if external_id:
            movie_id = hashlib.sha256(("external|" + external_id).encode()).hexdigest()[:32]
            c.execute("""INSERT OR IGNORE INTO registry_movies
              (id,external_id,title,metadata,created_at) VALUES(?,?,?,?,?)""",
              (movie_id, external_id[:200], title[:300] or "Untitled", _json(metadata or {}), now))
        c.execute("""INSERT INTO registry_resources
          (id,source_id,movie_id,canonical_url,resource_type,access_state,validation_state,
           media_type,metadata,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(source_id,canonical_url) DO UPDATE SET
          access_state=excluded.access_state, validation_state=excluded.validation_state,
          media_type=COALESCE(excluded.media_type,registry_resources.media_type),
          metadata=excluded.metadata, updated_at=excluded.updated_at""",
          (resource_id, source_id, movie_id, canonical, resource_type, access_state,
           validation_state, media_type, _json(metadata or {}), now, now))
        row = c.execute("SELECT * FROM registry_resources WHERE id=?", (resource_id,)).fetchone()
        c.execute("INSERT INTO registry_history VALUES(?,?,?,?,?)",
                  (uuid.uuid4().hex, resource_id, "UPSERT", _json({"access_state": access_state,
                   "validation_state": validation_state}), now))
        c.commit()
    return dict(row)


def search_resources(query: str, limit: int = 20) -> list[dict]:
    needle = "%" + query.strip().replace("%", "\\%").replace("_", "\\_")[:100] + "%"
    with connect() as c:
        rows = c.execute("""SELECT r.*,m.title,m.external_id,s.name AS source_name
          FROM registry_resources r JOIN registry_sources s ON s.id=r.source_id
          LEFT JOIN registry_movies m ON m.id=r.movie_id
          WHERE (m.title LIKE ? ESCAPE '\\' OR r.canonical_url LIKE ? ESCAPE '\\')
          ORDER BY CASE WHEN r.playback_state='PLAYER_CONFIRMED' THEN 0
                        WHEN r.validation_state='validated' THEN 1 ELSE 2 END,
                   r.updated_at DESC LIMIT ?""", (needle, needle, max(1, min(limit, 50)))).fetchall()
        return [dict(row) for row in rows]


def record_playback(resource_id: str, evidence: dict) -> dict | None:
    if evidence.get("state") != "PLAYER_CONFIRMED" or float(evidence.get("progressed_seconds", 0)) < 2:
        raise ValueError("Sustained video time progression evidence is required")
    now = int(time.time())
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT * FROM registry_resources WHERE id=?", (resource_id,)).fetchone()
        if row is None:
            c.rollback()
            return None
        if row["access_state"] != "PUBLIC" or row["validation_state"] != "validated":
            c.rollback()
            raise PermissionError("Resource must be validated and public")
        c.execute("""UPDATE registry_resources SET playback_state='PLAYER_CONFIRMED',
          updated_at=? WHERE id=?""", (now, resource_id))
        c.execute("INSERT INTO registry_verifications VALUES(?,?,?,?,?)",
                  (uuid.uuid4().hex, resource_id, "PLAYER", "PLAYER_CONFIRMED", _json(evidence), now))
        c.execute("INSERT INTO registry_history VALUES(?,?,?,?,?)",
                  (uuid.uuid4().hex, resource_id, "PLAYBACK_CONFIRMED", _json(evidence), now))
        updated = dict(c.execute("SELECT * FROM registry_resources WHERE id=?", (resource_id,)).fetchone())
        c.commit()
        return updated


init()
