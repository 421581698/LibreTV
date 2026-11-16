from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from app.workflow_store import PostgresWorkflowStore, WorkflowDefinitionError


def test_workflow_store_rejects_cycles_and_unknown_edges() -> None:
    nodes = [
        {"node_id": "discover", "node_type": "discover"},
        {"node_id": "crawl", "node_type": "crawl"},
    ]
    with pytest.raises(WorkflowDefinitionError):
        PostgresWorkflowStore._validate_graph(
            nodes, [("discover", "crawl"), ("crawl", "discover")]
        )
    with pytest.raises(WorkflowDefinitionError):
        PostgresWorkflowStore._validate_graph(nodes, [("missing", "crawl")])


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="PostgreSQL integration database is not configured",
)
def test_postgres_workflow_dag_claims_dependencies_and_retries_durably() -> None:
    database_url = os.environ["DATABASE_URL"]
    store = PostgresWorkflowStore(database_url)
    store.initialize()
    workflow_id = "dag_test_" + uuid.uuid4().hex
    nodes = [
        {"node_id": "discover", "node_type": "discover", "max_attempts": 1},
        {"node_id": "analyze", "node_type": "analyze", "max_attempts": 2},
        {"node_id": "candidate", "node_type": "candidate", "max_attempts": 1},
    ]
    edges = [("discover", "analyze"), ("analyze", "candidate")]

    try:
        assert store.create_workflow(workflow_id, nodes, edges, {"source": "test"})
        assert not store.create_workflow(workflow_id, nodes, edges)
        first = store.claim_ready_node("worker-a", lease_seconds=30)
        assert first is not None
        assert first["node_id"] == "discover"
        assert store.claim_ready_node("worker-b", lease_seconds=30) is None
        assert store.complete_node(
            workflow_id, "discover", "worker-a", {"sites": ["example.com"]}
        )

        second = store.claim_ready_node("worker-b", lease_seconds=30)
        assert second is not None
        assert second["node_id"] == "analyze"
        assert second["dependencies"]["discover"] == {"sites": ["example.com"]}
        assert store.fail_node(
            workflow_id, "analyze", "worker-b", "temporary model timeout", 0
        ) == "retry_wait"
        retried = store.claim_ready_node("worker-c", lease_seconds=30)
        assert retried is not None
        assert retried["node_id"] == "analyze"
        assert retried["attempt_count"] == 2
        assert store.fail_node(
            workflow_id, "analyze", "worker-c", "second model timeout", 0
        ) == "failed"

        workflow = store.get_workflow(workflow_id)
        assert workflow is not None
        assert workflow["status"] == "failed"
        assert [node["status"] for node in workflow["nodes"]] == [
            "completed",
            "failed",
            "pending",
        ]
        event_types = [event["type"] for event in store.events_after(workflow_id)]
        assert event_types == [
            "workflow_created",
            "node_claimed",
            "node_completed",
            "node_claimed",
            "node_retry_scheduled",
            "node_claimed",
            "node_failed",
        ]
    finally:
        with psycopg.connect(database_url) as db:
            db.execute(
                "DELETE FROM resource_workflows WHERE workflow_id = %s",
                (workflow_id,),
            )
