from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from app.candidate_store import PostgresCandidateStore


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="PostgreSQL integration database is not configured",
)
def test_candidate_ingestion_deduplicates_and_preserves_evidence_without_publishing() -> None:
    database_url = os.environ["DATABASE_URL"]
    store = PostgresCandidateStore(database_url)
    store.initialize()
    workflow_id = "candidate_test_" + uuid.uuid4().hex

    try:
        ids = store.ingest_crawl_items(
            workflow_id,
            [
                {
                    "url": "https://example.com/catalog#first",
                    "title": "Example Catalogue",
                    "status": 200,
                    "text": "First observed page",
                },
                {
                    "url": "https://example.com/catalog#second",
                    "title": "Updated title",
                    "status": 200,
                    "text": "Second observation",
                },
                {"url": "http://127.0.0.1/private", "title": "Unsafe target"},
            ],
        )
        assert len(ids) == 2
        assert ids[0] == ids[1]
        candidate = store.get_candidate(ids[0])
        assert candidate is not None
        assert candidate["status"] == "pending_review"
        assert candidate["title"] == "Example Catalogue"
        assert len(candidate["evidence"]) == 2
        assert candidate["source_url"] == "https://example.com/catalog"
        assert store.list_candidates(status="pending_review", limit=10)[0][
            "candidate_id"
        ] == ids[0]
    finally:
        with psycopg.connect(database_url) as db:
            db.execute(
                "DELETE FROM resource_candidates WHERE discovery_workflow_id = %s",
                (workflow_id,),
            )
