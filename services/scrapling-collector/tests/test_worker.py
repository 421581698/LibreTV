import unittest
from unittest.mock import patch

import worker


class WorkerPipelineTests(unittest.TestCase):
    def test_seedhub_catalogue_job_queues_next_batch_and_detail_enrichment(self):
        submitted = []
        def submit(job_type, payload, key):
            submitted.append((job_type, payload, key))
            return {"id": f"job-{len(submitted)}"}

        with (
            patch.object(worker, "sync_seedhub_pages", return_value={
                "status": "succeeded", "records_indexed": 100,
                "next_page": 51, "total_pages": 1428,
            }),
            patch.object(worker, "submit_job", side_effect=submit),
        ):
            result = worker.handle(
                {"_job_type": "seedhub_sync", "category": "movies", "start_page": 1, "pages": 50},
                lambda event: None,
                lambda: False,
            )

        self.assertEqual(result["detail_enrichment_job_id"], "job-1")
        self.assertEqual(result["next_catalog_job_id"], "job-2")
        self.assertEqual(submitted[0][0], "seedhub_detail_sync")
        self.assertEqual(submitted[1][0], "seedhub_sync")
        self.assertEqual(submitted[1][1], {"category": "movies", "start_page": 51, "pages": 50})
        self.assertEqual(submitted[1][2], "seedhub-catalog:movies:page:51")

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
