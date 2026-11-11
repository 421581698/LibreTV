import unittest
from unittest.mock import patch

import worker


class WorkerPipelineTests(unittest.TestCase):
    def test_batch_job_aggregates_unique_media_across_fmhy_sites_until_minimum(self):
        sites = [
            {"host": "catalog-one.example", "url": "https://catalog-one.example/video", "title": "One"},
            {"host": "catalog-two.example", "url": "https://catalog-two.example/video", "title": "Two"},
            {"host": "catalog-three.example", "url": "https://catalog-three.example/video", "title": "Three"},
        ]
        checkpoints = []
        calls = []

        def fake_crawl(request, cancel_check=None):
            site_index = len(calls)
            calls.append(str(request.url))
            candidates = [
                {
                    "id": f"{site_index * 60 + index + 1:032x}",
                    "url": f"https://media-{site_index}.example/{index}.m3u8",
                    "kind": "direct-media",
                    "status": "pending",
                }
                for index in range(60)
            ]
            return {"status": "partial", "task_id": f"{site_index + 1:032x}", "candidates": candidates}

        with (
            patch.object(worker, "require_egress_firewall"),
            patch.object(worker, "discover_sites", return_value=sites),
            patch.object(worker, "get_discovered_sites", return_value=sites),
            patch.object(worker, "crawl_site", side_effect=fake_crawl),
            patch.object(worker, "validate_candidate", return_value={
                "validation": {"reachable": True, "access": {"access_state": "PUBLIC"}}
            }) as validate,
        ):
            result = worker.run_batch_crawl(
                {"minimum": 101, "target": 101, "max_sites": 3},
                checkpoints.append,
                lambda: False,
            )

        self.assertTrue(result["batch_target"]["met"])
        self.assertEqual(result["batch_target"]["collected"], 180)
        self.assertEqual(result["sites_scanned"], 3)
        self.assertEqual(len(calls), 3)
        self.assertEqual(validate.call_count, 100)
        self.assertIn("batch_site_completed", [item["stage"] for item in checkpoints])

    def test_daily_scheduler_queues_one_full_directory_batch(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        with (
            patch.dict("os.environ", {
                "COLLECTOR_TIMEZONE": "UTC",
                "COLLECTOR_DAILY_HOUR": "3",
                "COLLECTOR_DAILY_MINUTE": "0",
            }),
            patch.object(worker, "submit_job", return_value={"id": "daily-job", "status": "queued"}) as submit,
        ):
            result = worker.enqueue_daily_batch(datetime(2026, 11, 11, 4, 0, tzinfo=ZoneInfo("UTC")))
        self.assertEqual(result["job_id"], "daily-job")
        args = submit.call_args.args
        self.assertEqual(args[0], "batch_crawl")
        self.assertEqual(args[1]["max_sites"], 1000)
        self.assertEqual(args[1]["target"], 1000)
        self.assertEqual(args[2], "daily-fmhy-batch:2026-11-11")

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
