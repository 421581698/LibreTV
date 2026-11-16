from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row


def _now() -> str:
    return datetime.now(UTC).isoformat()


class PostgresJobStore:
    """PostgreSQL-backed durable crawl task, result, and audit-event store."""

    def __init__(self, database_url: str) -> None:
        if not database_url.startswith(("postgres://", "postgresql://")):
            raise ValueError("DATABASE_URL must use PostgreSQL")
        self.database_url = database_url

    @contextmanager
    def _connection(self) -> Iterator[psycopg.Connection]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def initialize(self) -> None:
        with self._connection() as db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS crawl_jobs (
                    task_id TEXT PRIMARY KEY,
                    seeds_json JSONB NOT NULL,
                    status TEXT NOT NULL,
                    checkpoint_dir TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    result_json JSONB,
                    error TEXT
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS crawl_events (
                    id BIGSERIAL PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES crawl_jobs(task_id) ON DELETE CASCADE,
                    event_type TEXT NOT NULL,
                    payload_json JSONB NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS crawl_results (
                    task_id TEXT NOT NULL REFERENCES crawl_jobs(task_id) ON DELETE CASCADE,
                    sequence BIGINT NOT NULL,
                    item_json JSONB NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (task_id, sequence)
                )
                """
            )
            db.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_crawl_events_task_id_id
                ON crawl_events(task_id, id)
                """
            )
            db.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status_created
                ON crawl_jobs(status, created_at)
                """
            )

    @staticmethod
    def _event(
        db: psycopg.Connection,
        task_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        db.execute(
            """
            INSERT INTO crawl_events (task_id, event_type, payload_json, created_at)
            VALUES (%s, %s, %s::jsonb, %s)
            """,
            (task_id, event_type, json.dumps(payload, ensure_ascii=False), _now()),
        )

    def create(self, task_id: str, seeds: list[str], checkpoint_dir: str) -> bool:
        now = _now()
        with self._connection() as db:
            cursor = db.execute(
                """
                INSERT INTO crawl_jobs
                    (task_id, seeds_json, status, checkpoint_dir, created_at, updated_at)
                VALUES (%s, %s::jsonb, 'queued', %s, %s, %s)
                ON CONFLICT (task_id) DO NOTHING
                """,
                (task_id, json.dumps(seeds), checkpoint_dir, now, now),
            )
            created = cursor.rowcount == 1
            if created:
                self._event(db, task_id, "queued", {"seeds": seeds})
            return created

    def update(self, task_id: str, status: str, **fields: Any) -> None:
        allowed = {"started_at", "finished_at", "result_json", "error"}
        updates = {key: value for key, value in fields.items() if key in allowed}
        updates["status"] = status
        updates["updated_at"] = _now()
        assignments: list[str] = []
        values: list[Any] = []
        for key, value in updates.items():
            assignments.append(f"{key} = %s::jsonb" if key == "result_json" else f"{key} = %s")
            values.append(value)
        values.append(task_id)
        with self._connection() as db:
            cursor = db.execute(
                f"UPDATE crawl_jobs SET {', '.join(assignments)} WHERE task_id = %s",
                values,
            )
            if cursor.rowcount == 0:
                raise KeyError(f"Unknown crawl task: {task_id}")
            self._event(
                db,
                task_id,
                status,
                {key: value for key, value in fields.items() if key != "result_json"},
            )

    def add_event(self, task_id: str, event_type: str, payload: dict[str, Any]) -> None:
        with self._connection() as db:
            self._event(db, task_id, event_type, payload)

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self._connection() as db:
            row = db.execute(
                "SELECT * FROM crawl_jobs WHERE task_id = %s",
                (task_id,),
            ).fetchone()
        if row is None:
            return None
        item = dict(row)
        item["seeds"] = item.pop("seeds_json")
        result = item.pop("result_json")
        if result is not None:
            item["result"] = result
        return item

    def add_result(self, task_id: str, item: dict[str, Any]) -> int:
        with self._connection() as db:
            db.execute(
                "SELECT task_id FROM crawl_jobs WHERE task_id = %s FOR UPDATE",
                (task_id,),
            )
            row = db.execute(
                "SELECT COALESCE(MAX(sequence), 0) AS max_sequence "
                "FROM crawl_results WHERE task_id = %s",
                (task_id,),
            ).fetchone()
            sequence = int(row["max_sequence"]) + 1
            db.execute(
                """
                INSERT INTO crawl_results (task_id, sequence, item_json, created_at)
                VALUES (%s, %s, %s::jsonb, %s)
                """,
                (task_id, sequence, json.dumps(item, ensure_ascii=False), _now()),
            )
        return sequence

    def get_results(self, task_id: str) -> list[dict[str, Any]]:
        with self._connection() as db:
            rows = db.execute(
                "SELECT item_json FROM crawl_results WHERE task_id = %s ORDER BY sequence",
                (task_id,),
            ).fetchall()
        return [row["item_json"] for row in rows]

    def events_after(self, task_id: str, last_id: int) -> list[dict[str, Any]]:
        with self._connection() as db:
            rows = db.execute(
                """
                SELECT id, event_type, payload_json, created_at
                FROM crawl_events
                WHERE task_id = %s AND id > %s
                ORDER BY id
                """,
                (task_id, last_id),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "type": row["event_type"],
                "payload": row["payload_json"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def list_queued(self) -> list[dict[str, Any]]:
        with self._connection() as db:
            rows = db.execute(
                "SELECT task_id FROM crawl_jobs WHERE status = 'queued' "
                "ORDER BY created_at, task_id"
            ).fetchall()
        jobs = [self.get(row["task_id"]) for row in rows]
        return [job for job in jobs if job is not None]

    def recover_interrupted(self) -> list[str]:
        with self._connection() as db:
            rows = db.execute(
                "SELECT task_id FROM crawl_jobs WHERE status IN ('running', 'pausing') "
                "FOR UPDATE"
            ).fetchall()
            task_ids = [row["task_id"] for row in rows]
            for task_id in task_ids:
                db.execute(
                    "UPDATE crawl_jobs SET status = 'interrupted', updated_at = %s "
                    "WHERE task_id = %s",
                    (_now(), task_id),
                )
                self._event(db, task_id, "interrupted", {"reason": "service_restart"})
        return task_ids
