from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator


def _now() -> str:
    return datetime.now(UTC).isoformat()


class JobStore:
    """Small SQLite-backed registry for crawl jobs and their audit events."""

    def __init__(self, database_path: str) -> None:
        self.path = Path(database_path)

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        with self._connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS crawl_jobs (
                    task_id TEXT PRIMARY KEY,
                    seeds_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    checkpoint_dir TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    result_json TEXT,
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS crawl_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL REFERENCES crawl_jobs(task_id) ON DELETE CASCADE,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_crawl_events_task_id_id
                    ON crawl_events(task_id, id);
                """
            )

    def create(self, task_id: str, seeds: list[str], checkpoint_dir: str) -> bool:
        now = _now()
        with self._connection() as db:
            cursor = db.execute(
                """
                INSERT OR IGNORE INTO crawl_jobs
                (task_id, seeds_json, status, checkpoint_dir, created_at, updated_at)
                VALUES (?, ?, 'queued', ?, ?, ?)
                """,
                (task_id, json.dumps(seeds), checkpoint_dir, now, now),
            )
            created = cursor.rowcount == 1
            if created:
                self._event(db, task_id, "queued", {"seeds": seeds})
            return created

    @staticmethod
    def _event(
        db: sqlite3.Connection,
        task_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        db.execute(
            """
            INSERT INTO crawl_events (task_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (task_id, event_type, json.dumps(payload, ensure_ascii=False), _now()),
        )

    def update(self, task_id: str, status: str, **fields: Any) -> None:
        allowed = {"started_at", "finished_at", "result_json", "error"}
        updates = {key: value for key, value in fields.items() if key in allowed}
        updates["status"] = status
        updates["updated_at"] = _now()
        assignments = ", ".join(f"{key} = ?" for key in updates)
        with self._connection() as db:
            db.execute(
                f"UPDATE crawl_jobs SET {assignments} WHERE task_id = ?",
                (*updates.values(), task_id),
            )
            self._event(db, task_id, status, {
                key: value for key, value in fields.items() if key != "result_json"
            })

    def add_event(self, task_id: str, event_type: str, payload: dict[str, Any]) -> None:
        with self._connection() as db:
            self._event(db, task_id, event_type, payload)

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self._connection() as db:
            row = db.execute(
                "SELECT * FROM crawl_jobs WHERE task_id = ?", (task_id,)
            ).fetchone()
        if row is None:
            return None
        item = dict(row)
        item["seeds"] = json.loads(item.pop("seeds_json"))
        if item["result_json"]:
            item["result"] = json.loads(item["result_json"])
        item.pop("result_json")
        return item

    def events_after(self, task_id: str, last_id: int) -> list[dict[str, Any]]:
        with self._connection() as db:
            rows = db.execute(
                """
                SELECT id, event_type, payload_json, created_at
                FROM crawl_events WHERE task_id = ? AND id > ? ORDER BY id
                """,
                (task_id, last_id),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "type": row["event_type"],
                "payload": json.loads(row["payload_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def recover_interrupted(self) -> list[str]:
        """Mark jobs left running by a process restart as interrupted."""
        with self._connection() as db:
            rows = db.execute(
                "SELECT task_id FROM crawl_jobs WHERE status IN ('queued', 'running', 'pausing')"
            ).fetchall()
            task_ids = [row["task_id"] for row in rows]
            for task_id in task_ids:
                db.execute(
                    "UPDATE crawl_jobs SET status = 'interrupted', updated_at = ? "
                    "WHERE task_id = ?",
                    (_now(), task_id),
                )
                self._event(db, task_id, "interrupted", {"reason": "service_restart"})
        return task_ids
