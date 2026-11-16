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
                    "url": f"https://example.com/catalog/{workflow_id}",
                    "media_urls": [f"https://example.com/movie-{workflow_id}.m3u8#first"],
                    "title": "Example Catalogue",
                    "status": 200,
                    "text": "First observed page",
                },
                {
                    "url": f"https://example.com/catalog/{workflow_id}",
                    "media_urls": [f"https://example.com/movie-{workflow_id}.m3u8#second"],
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
        assert candidate["source_url"] == f"https://example.com/movie-{workflow_id}.m3u8"
        report = {
            "quality_label": "4K_claim",
            "is_4k_claim": True,
            "native_4k_verified": False,
        }
        assert store.save_quality_report(ids[0], report)
        candidate = store.get_candidate(ids[0])
        assert candidate["quality_json"] == report
        assert any(
            item["candidate_id"] == ids[0]
            for item in store.list_candidates(status="pending_review", limit=200)
        )
        assert store.review_candidate(
            ids[0], "approved", "test-reviewer", "Evidence reviewed"
        )
        reviewed = store.get_candidate(ids[0])
        assert reviewed is not None
        assert reviewed["status"] == "approved"
        assert any(
            evidence["evidence_type"] == "human_review"
            and evidence["evidence_json"]["reviewer_id"] == "test-reviewer"
            for evidence in reviewed["evidence"]
        )
        assert not store.review_candidate(ids[0], "rejected", "test-reviewer")
        assert not any(
            evidence["evidence_type"] == "formal_resource_publish"
            for evidence in reviewed["evidence"]
        )
    finally:
        with psycopg.connect(database_url) as db:
            db.execute(
                "DELETE FROM resource_candidates WHERE discovery_workflow_id = %s",
                (workflow_id,),
            )
