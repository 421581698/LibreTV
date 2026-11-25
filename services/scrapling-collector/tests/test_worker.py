import unittest
from unittest.mock import patch

import worker


class WorkerPipelineTests(unittest.TestCase):
    def test_durable_media_job_routes_hls_to_graph_aware_gateway(self):
        import json
        from unittest.mock import patch

        checkpoints = []
        with (
            patch.object(worker, "require_egress_firewall"),
            patch("dv_source_gateway._read_candidate", return_value={
                "validation": json.dumps({"media_format": "hls"}),
            }),
            patch("dv_hls_source_gateway.ingest_authorized_hls_candidate", return_value={
                "status": "registered", "member_count": 3, "edge_count": 2,
            }) as ingest_hls,
        ):
            result = worker.handle(
                {
                    "_job_type": "dv_media_ingest",
                    "candidate_id": "a" * 32,
                    "resource_id": "r_" + "b" * 28,
                },
                checkpoints.append,
                lambda: False,
            )
        self.assertEqual(result["status"], "registered")
        ingest_hls.assert_called_once()
        self.assertIn("authorized_media_ingest_finished", [item["stage"] for item in checkpoints])

    def test_stale_media_job_is_rejected_before_fetch_when_candidate_changes(self):
        import hashlib
        import json
        from unittest.mock import patch

        old_url = "https://media.example/old.mp4"
        old_validation = json.dumps({"media_format": "progressive", "content_type": "video/mp4"})
        expected_version = hashlib.sha256(
            (old_url + "\0" + old_validation).encode("utf-8")
        ).hexdigest()[:24]
        changed_candidate = {
            "url": "https://media.example/new.mp4",
            "validation": json.dumps({"media_format": "progressive", "content_type": "video/mp4"}),
        }
        with (
            patch.object(worker, "require_egress_firewall"),
            patch("dv_source_gateway._read_candidate", return_value=changed_candidate),
            patch("dv_source_gateway.ingest_authorized_candidate") as ingest,
        ):
            with self.assertRaisesRegex(RuntimeError, "candidate_changed_after_queue"):
                worker.handle(
                    {
                        "_job_type": "dv_media_ingest",
                        "candidate_id": "c" * 32,
                        "resource_id": "r_" + "d" * 28,
                        "source_version": expected_version,
                    },
                    lambda _event: None,
                    lambda: False,
                )
        ingest.assert_not_called()

    def test_crawl_job_preflights_pending_direct_media_into_registry(self):
        task_id = "a" * 32
        candidates = [
            {"id": "1" * 32, "kind": "direct-media", "status": "pending"},
            {"id": "2" * 32, "kind": "direct-media", "status": "pending"},
            {"id": "3" * 32, "kind": "embedded-player", "status": "pending"},
            {"id": "4" * 32, "kind": "direct-media", "status": "rejected"},
        ]
        checkpoints = []
        validation_results = [
            {"validation": {"reachable": True, "access": {"access_state": "PUBLIC"}}},
            {"validation": {"reachable": False, "access": {"access_state": "AUTH_REQUIRED"}}},
        ]

        with (
            patch.object(worker, "crawl_site", return_value={
                "task_id": task_id, "status": "completed", "count": 4,
            }) as crawl,
            patch.object(worker, "task_candidates", return_value={"candidates": candidates}),
            patch.object(worker, "validate_candidate", side_effect=validation_results) as validate,
        ):
            result = worker.handle(
                {"url": "https://catalog.example/", "mode": "auto", "limit": 10, "search_keyword": "Sample Film"},
                checkpoints.append,
                lambda: False,
            )

        crawl.assert_called_once()
        self.assertEqual(crawl.call_args.args[0].search_keyword, "Sample Film")
        self.assertEqual([call.args[0] for call in validate.call_args_list], ["1" * 32, "2" * 32])
        self.assertEqual(result["preflight"], {
            "checked": 2, "validated": 1, "rejected": 1, "errors": [],
        })
        self.assertEqual(result["registry_ready"], 1)
        self.assertIn("media_preflight_completed", [item["stage"] for item in checkpoints])

    def test_crawl_job_does_not_preflight_non_media_candidates(self):
        with (
            patch.object(worker, "crawl_site", return_value={"task_id": "b" * 32, "count": 1}),
            patch.object(worker, "task_candidates", return_value={
                "candidates": [{"id": "c" * 32, "kind": "cms-api-candidate", "status": "pending"}],
            }),
            patch.object(worker, "validate_candidate") as validate,
        ):
            result = worker.handle(
                {"url": "https://catalog.example/", "mode": "http", "limit": 5},
                lambda event: None,
                lambda: False,
            )
        validate.assert_not_called()
        self.assertEqual(result["preflight"]["checked"], 0)


if __name__ == "__main__":
    unittest.main()
