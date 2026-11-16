from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from app.postgres_job_store import PostgresJobStore
from app.worker import CrawlWorker, LeaseLost


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="PostgreSQL integration database is not configured",
)
def test_worker_fences_result_and_completion_writes_to_current_lease_owner() -> None:
    database_url = os.environ["DATABASE_URL"]
    store = PostgresJobStore(database_url)
    store.initialize()
    task_id = "worker_fence_" + uuid.uuid4().hex
    worker = CrawlWorker(database_url, "worker-one", lease_seconds=30)

    try:
        assert store.create(task_id, ["https://example.com/"], "/tmp/" + task_id)
        claimed = store.claim_next("worker-one", lease_seconds=30)
        assert claimed is not None and claimed["task_id"] == task_id

        worker._fenced_result(
            task_id,
            {"url": "https://example.com/", "title": "Example Domain"},
        )
        assert store.get_results(task_id)[0]["title"] == "Example Domain"

        other_worker = CrawlWorker(database_url, "worker-two", lease_seconds=30)
        with pytest.raises(LeaseLost):
            other_worker._fenced_result(
                task_id,
                {"url": "https://attacker.invalid/", "title": "Must not persist"},
            )

        worker._fenced_finish(
            task_id,
            "completed",
            {"items": store.get_results(task_id), "completed": True},
        )
        job = store.get(task_id)
        assert job is not None
        assert job["status"] == "completed"
        assert job["lease_owner"] is None
        assert [event["type"] for event in store.events_after(task_id, 0)] == [
            "queued",
            "claimed",
            "item",
            "completed",
        ]
    finally:
        with psycopg.connect(database_url) as db:
            db.execute("DELETE FROM crawl_jobs WHERE task_id = %s", (task_id,))
