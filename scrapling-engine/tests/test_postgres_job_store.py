from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from app.postgres_job_store import PostgresJobStore


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="PostgreSQL integration database is not configured",
)
def test_postgres_job_store_persists_jobs_results_and_ordered_events() -> None:
    database_url = os.environ["DATABASE_URL"]
    store = PostgresJobStore(database_url)
    store.initialize()
    task_id = "pg_test_" + uuid.uuid4().hex

    try:
        assert store.create(task_id, ["https://example.com/"], "/tmp/" + task_id)
        assert not store.create(task_id, ["https://example.com/"], "/tmp/" + task_id)
        assert store.get(task_id)["seeds"] == ["https://example.com/"]

        claimed = store.claim_next("worker-one", lease_seconds=30)
        assert claimed is not None and claimed["task_id"] == task_id
        assert claimed["lease_owner"] == "worker-one"
        assert store.claim_next("worker-two", lease_seconds=30) is None
        assert store.heartbeat(task_id, "worker-one", lease_seconds=30)
        assert not store.heartbeat(task_id, "worker-two", lease_seconds=30)
        assert store.release_lease(task_id, "worker-one", "queued")
        reclaimed = store.claim_next("worker-two", lease_seconds=30)
        assert reclaimed is not None and reclaimed["lease_owner"] == "worker-two"

        sequence = store.add_result(
            task_id,
            {"url": "https://example.com/", "title": "Example Domain"},
        )
        assert sequence == 1
        assert store.get_results(task_id)[0]["title"] == "Example Domain"

        store.update(
            task_id,
            "completed",
            result_json='{"count": 1}',
            finished_at="2026-11-16T00:00:00+00:00",
        )
        job = store.get(task_id)
        assert job is not None
        assert job["status"] == "completed"
        assert job["result"] == {"count": 1}

        events = store.events_after(task_id, 0)
        assert [event["type"] for event in events] == [
            "queued",
            "claimed",
            "lease_released",
            "claimed",
            "completed",
        ]
        assert events[0]["payload"]["seeds"] == ["https://example.com/"]
    finally:
        with psycopg.connect(database_url) as db:
            db.execute("DELETE FROM crawl_jobs WHERE task_id = %s", (task_id,))
