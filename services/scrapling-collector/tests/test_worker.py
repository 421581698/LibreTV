import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import worker


class WorkerPipelineTests(unittest.TestCase):
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

    def test_discovery_queues_every_discovered_site_not_only_first_five(self):
        sites = [
            {"host": f"site-{index}.example", "url": f"https://site-{index}.example/"}
            for index in range(1005)
        ]
        queued = []
        with (
            patch.object(worker, "require_egress_firewall"),
            patch.object(worker, "discover_sites", return_value=sites),
            patch.object(worker, "submit_job", side_effect=lambda kind, payload, key: queued.append(payload) or {"id": str(len(queued))}),
        ):
            result = worker.handle(
                {"_job_type": "discover", "search_keyword": "sample"},
                lambda event: None,
                lambda: False,
            )
        self.assertEqual(result["discovered"], 1005)
        self.assertEqual(len(result["queued_jobs"]), 1000)
        self.assertEqual(len(queued), 1000)
        self.assertEqual(worker.MAX_BATCH_SITE_JOBS, 1000)
        self.assertTrue(all(item["limit"] == 1000 for item in queued))
        self.assertEqual(result["target_tasks"], 1000)
        self.assertTrue(result["batch_id"])

    def test_candidate_and_discovery_limits_support_at_least_one_thousand(self):
        import app
        self.assertGreaterEqual(app.MAX_RESULTS, 1000)
        self.assertGreaterEqual(app.MAX_CANDIDATES, 1000)
        self.assertGreaterEqual(worker.MAX_AUTOMATIC_MEDIA_PREFLIGHTS, 1000)

    def test_batch_counts_collected_observations_separately_from_unique_candidates(self):
        import app
        old_db_path = app.DB_PATH
        old_registry_path = app.registry_store.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            try:
                app.DB_PATH = Path(directory) / "batch.sqlite3"
                app.init_db()
                batch_id = "a" * 32
                with app.db() as connection:
                    connection.execute(
                        """INSERT INTO collection_batches
                           (id,target_candidates,target_collected,status,created_at,updated_at)
                           VALUES(?,1000,1000,'running',1,1)""",
                        (batch_id,),
                    )
                    for index, host in enumerate(("one.example", "two.example"), start=1):
                        task_id = str(index) * 32
                        connection.execute(
                            """INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at,batch_id)
                               VALUES(?,?,?,'completed','auto',1,1,?)""",
                            (task_id, f"https://{host}/", host, batch_id),
                        )
                        connection.execute(
                            """INSERT INTO collection_observations
                               (id,batch_id,task_id,canonical_url,host,kind,created_at)
                               VALUES(?,?,?,?,?,'direct-media',1)""",
                            (str(index + 2) * 32, batch_id, task_id, "https://cdn.example/movie.mp4", host),
                        )
                    connection.execute(
                        """INSERT INTO candidates
                           (id,task_id,url,host,kind,title,status,created_at,batch_id,canonical_url)
                           VALUES(?,?,'https://cdn.example/movie.mp4','one.example','direct-media','Movie','pending',1,?,?)""",
                        ("c" * 32, "1" * 32, batch_id, "https://cdn.example/movie.mp4"),
                    )
                progress = app.refresh_collection_batch(batch_id)
                self.assertEqual(progress["candidate_count"], 1)
                self.assertEqual(progress["collected_count"], 2)
            finally:
                app.DB_PATH = old_db_path
                app.init_db()
                app.registry_store.DB_PATH = old_registry_path

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
