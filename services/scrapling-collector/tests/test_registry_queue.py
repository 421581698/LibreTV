import os
import tempfile
import unittest
from unittest.mock import patch

import registry_queue as queue


class RegistryQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "collector.sqlite3")
        self.patch = patch.object(queue, "DB_PATH", __import__("pathlib").Path(self.db))
        self.patch.start()
        queue.initialize()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_fmhy_site_registry_is_owned_by_canonical_registry_module(self):
        inserted = queue.upsert_discovered_sites([
            {
                "host": "catalog.example",
                "title": "Catalog",
                "url": "https://catalog.example/video#client-state",
                "directory": "FMHY / Video",
            },
            {
                "host": "private.example",
                "title": "Private",
                "url": "http://private.example/",
                "directory": "FMHY / Video",
            },
            {
                "host": "127.0.0.1",
                "title": "Loopback",
                "url": "https://127.0.0.1/admin",
                "directory": "FMHY / Video",
            },
            {
                "host": "signed.example",
                "title": "Signed",
                "url": "https://signed.example/?token=secret",
                "directory": "FMHY / Video",
            },
        ], discovered_at=123)
        self.assertEqual(inserted, 1)
        self.assertTrue(queue.is_discovered_host("CATALOG.EXAMPLE"))
        self.assertFalse(queue.is_discovered_host("private.example"))
        sites = queue.list_discovered_sites(10)
        with queue.connect() as connection:
            same_connection_sites = queue.list_discovered_sites(10, connection=connection)
        self.assertEqual(sites, same_connection_sites)
        self.assertEqual([item["host"] for item in sites], ["catalog.example"])
        self.assertEqual(sites[0]["url"], "https://catalog.example/video")
        with queue.connect() as connection:
            connection.execute(
                "INSERT INTO sites(host,title,url,directory,discovered_at) VALUES(?,?,?,?,?)",
                ("other.example", "Other", "https://other.example/", "Other / Directory", 124),
            )
        self.assertFalse(queue.is_discovered_host("other.example"))
        with queue.connect() as connection:
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM sites").fetchone()[0],
                2,
            )

    def test_crawl_job_page_budget_is_bounded(self):
        payload = queue.validate_durable_job_payload(
            "crawl", {"url": "https://catalog.example/video", "max_pages": 1}
        )
        self.assertEqual(payload["max_pages"], 1)
        for invalid in (0, 101, True, "1"):
            with self.subTest(max_pages=invalid):
                with self.assertRaises(ValueError):
                    queue.validate_durable_job_payload(
                        "crawl", {"url": "https://catalog.example/video", "max_pages": invalid}
                    )

    def test_bulk_job_status_returns_bounded_status_for_live_scale_harness(self):
        job = queue.submit_job("crawl", {"url": "https://example.com"}, "bulk-status:one")
        with patch.object(queue, "require_auth"):
            result = queue.api_bulk_job_status(
                {"ids": [job["id"]]}, authorization="Bearer test"
            )
            self.assertEqual(result["jobs"][0]["id"], job["id"])
            self.assertEqual(result["jobs"][0]["status"], "queued")
            with self.assertRaises(Exception):
                queue.api_bulk_job_status({"ids": ["invalid"]}, authorization="Bearer test")

    def test_ai_rule_jobs_preserve_bounded_failure_diagnostic_link(self):
        job = queue.submit_job(
            "rule_repair",
            {
                "host": "catalog.example",
                "page_html": "<a class='media'></a>",
                "fixtures": ["<a class='media'></a>"],
                "task_id": "task-1",
                "failure_code": "selector_miss",
                "diagnostic_id": "diagnostic-123",
            },
            "rule-repair:task-1",
        )
        payload = queue.safe_json(job["payload"])
        self.assertEqual(payload["diagnostic_id"], "diagnostic-123")

    def test_discovery_jobs_are_durable_and_idempotent(self):
        first = queue.submit_job("discover", {"search_keyword": "sample"}, "discover:sample")
        second = queue.submit_job("discover", {"search_keyword": "sample"}, "discover:sample")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["job_type"], "discover")

    def test_batch_crawl_jobs_are_durable_and_claimable(self):
        job = queue.submit_job(
            "batch_crawl",
            {"minimum": 101, "target": 250, "max_sites": 25},
            "batch:101-plus",
        )
        claimed = queue.claim_job("batch-worker")
        self.assertEqual(job["job_type"], "batch_crawl")
        self.assertEqual(claimed["id"], job["id"])
        self.assertEqual(claimed["job_type"], "batch_crawl")

    def test_batch_submit_accepts_full_fmhy_site_budget(self):
        with patch.object(queue, "require_auth"):
            result = queue.api_submit_batch(
                {"minimum": 101, "target": 1000, "max_sites": 1000, "idempotency_key": "daily:full-budget"},
                authorization="Bearer test",
            )
        self.assertEqual(result["batch_target"]["max_sites"], 1000)
        with queue.connect() as c:
            row = c.execute("SELECT payload FROM collector_jobs WHERE id=?", (result["job_id"],)).fetchone()
        payload = __import__("json").loads(row["payload"])
        self.assertEqual(payload["max_sites"], 1000)

    def test_durable_crawl_queue_rejects_signed_urls_but_keeps_public_query_params(self):
        public = queue.submit_job(
            "crawl",
            {"url": "https://Example.org:443/watch?quality=1080p&format=hls#client-secret"},
            "crawl:public-query",
        )
        self.assertEqual(public["status"], "queued")
        self.assertEqual(
            __import__("json").loads(public["payload"])["url"],
            "https://example.org:443/watch?quality=1080p&format=hls",
        )
        for url in (
            "https://example.org/watch?token=secret",
            "https://example.org/watch?X-Amz-Signature=secret",
            "https://example.org/watch path",
            r"https://example.org\\@127.0.0.1/watch",
            "https://user:password@example.org/watch",
            "http://example.org/watch",
            "https://example.org:8443/watch",
            "https://127.0.0.1/admin",
            "https://10.0.0.8/internal",
            "https://169.254.169.254/latest/meta-data/",
            "https://[::1]/admin",
            "https://[fc00::1]/internal",
        ):
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    queue.submit_job("crawl", {"url": url}, "crawl:unsafe:" + str(abs(hash(url))))

        with self.assertRaises(ValueError):
            queue.submit_jobs([{
                "job_type": "crawl",
                "payload": {"url": "https://example.org/watch?access_token=secret"},
                "idempotency_key": "bulk:signed-url",
            }])
        with queue.connect() as c:
            rows = c.execute("SELECT idempotency_key FROM collector_jobs ORDER BY idempotency_key").fetchall()
        self.assertEqual([row["idempotency_key"] for row in rows], ["crawl:public-query"])

    def test_bulk_submission_is_atomic_and_idempotent(self):
        jobs = [
            {"job_type": "crawl", "payload": {"url": "https://example.org/a"},
             "idempotency_key": "bulk:a"},
            {"job_type": "discover", "payload": {"search_keyword": "film"},
             "idempotency_key": "bulk:b"},
        ]
        first = queue.submit_jobs(jobs)
        second = queue.submit_jobs(jobs)
        self.assertEqual([item["id"] for item in first], [item["id"] for item in second])
        with queue.connect() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM collector_jobs").fetchone()[0], 2)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM collector_job_events WHERE event='queued'").fetchone()[0], 2)

        conflicting = [
            {"job_type": "crawl", "payload": {"url": "https://example.org/c"},
             "idempotency_key": "bulk:c"},
            {"job_type": "crawl", "payload": {"url": "https://example.org/changed"},
             "idempotency_key": "bulk:a"},
        ]
        with self.assertRaisesRegex(ValueError, "different job payload"):
            queue.submit_jobs(conflicting)
        with queue.connect() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM collector_jobs").fetchone()[0], 2)

    def test_bulk_submission_endpoint_requires_auth_and_bounds_batch_size(self):
        with self.assertRaises(Exception):
            queue.api_submit_jobs({"jobs": []}, authorization=None)
        with patch.object(queue, "require_auth"):
            with self.assertRaisesRegex(Exception, "1 to 1000"):
                queue.api_submit_jobs({"jobs": [{}] * 1001}, authorization="Bearer test")
            result = queue.api_submit_jobs({
                "jobs": [{"job_type": "crawl", "payload": {"url": "https://example.org"},
                          "idempotency_key": "bulk:api"}]
            }, authorization="Bearer test")
        self.assertEqual(len(result["jobs"]), 1)

    def test_idempotency_key_cannot_be_reused_for_different_payload(self):
        queue.submit_job("crawl", {"url": "https://example.org/a"}, "idempotency:collision")
        with self.assertRaisesRegex(ValueError, "different job payload"):
            queue.submit_job("crawl", {"url": "https://example.org/b"}, "idempotency:collision")
        with self.assertRaisesRegex(ValueError, "different job payload"):
            queue.submit_job("discover", {"search_keyword": "other"}, "idempotency:collision")
        with queue.connect() as c:
            rows = c.execute("SELECT job_type,payload FROM collector_jobs WHERE idempotency_key=?", ("idempotency:collision",)).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["job_type"], "crawl")
        self.assertEqual(__import__("json").loads(rows[0]["payload"]), {"url": "https://example.org/a"})

    def test_idempotent_job_submit_and_atomic_claim(self):
        first = queue.submit_job("crawl", {"url": "https://example.org"}, "crawl:example")
        second = queue.submit_job("crawl", {"url": "https://example.org"}, "crawl:example")
        self.assertEqual(first["id"], second["id"])
        claimed = queue.claim_job("worker-a", lease_seconds=30)
        self.assertEqual(claimed["attempt"], 1)
        self.assertIsNone(queue.claim_job("worker-b"))

    def test_initialize_does_not_recover_expired_worker_leases(self):
        job = queue.submit_job("crawl", {"url": "https://example.org"}, "lease:init-no-recovery")
        queue.claim_job("worker-a", lease_seconds=10)
        with queue.connect() as c:
            c.execute("UPDATE collector_jobs SET lease_until=0 WHERE id=?", (job["id"],))
        queue.initialize()
        with queue.connect() as c:
            row = c.execute("SELECT status,lease_owner FROM collector_jobs WHERE id=?", (job["id"],)).fetchone()
        self.assertEqual(row["status"], "running")
        self.assertEqual(row["lease_owner"], "worker-a")

    def test_lease_expiry_requeues_job(self):
        job = queue.submit_job("crawl", {"url": "https://example.org"}, "lease:test")
        queue.claim_job("worker-a", lease_seconds=10)
        with queue.connect() as c:
            c.execute("UPDATE collector_jobs SET lease_until=0 WHERE id=?", (job["id"],))
        reclaimed = queue.claim_job("worker-b")
        self.assertEqual(reclaimed["id"], job["id"])
        self.assertEqual(reclaimed["attempt"], 2)
        with queue.connect() as c:
            recovered = c.execute("SELECT COUNT(*) AS n FROM collector_job_events WHERE job_id=? AND event='lease_expired_recovered'", (job["id"],)).fetchone()["n"]
        self.assertEqual(recovered, 1)

    def test_expired_lease_at_max_attempts_moves_to_dead_letter(self):
        job = queue.submit_job("crawl", {"url": "https://example.org"}, "lease:dead-letter", max_attempts=1)
        queue.claim_job("worker-a")
        with queue.connect() as c:
            c.execute("UPDATE collector_jobs SET lease_until=0 WHERE id=?", (job["id"],))
        self.assertIsNone(queue.claim_job("worker-b"))
        with queue.connect() as c:
            row = c.execute("SELECT status,error,lease_owner FROM collector_jobs WHERE id=?", (job["id"],)).fetchone()
            event_row = c.execute(
                "SELECT event,detail FROM collector_job_events WHERE job_id=? AND event='dead_letter' LIMIT 1",
                (job["id"],),
            ).fetchone()
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["error"], "lease_expired_max_attempts")
        self.assertIsNone(row["lease_owner"])
        self.assertEqual(event_row["event"], "dead_letter")
        self.assertIn("lease_expired_max_attempts", event_row["detail"])

    def test_retry_backoff_then_dead_letter(self):
        job = queue.submit_job("crawl", {"url": "https://example.org"}, "retry:test", max_attempts=2)
        queue.claim_job("worker-a")
        self.assertTrue(queue.fail_job(job["id"], "worker-a", "NetworkError"))
        with queue.connect() as c:
            row = c.execute("SELECT status,available_at FROM collector_jobs WHERE id=?", (job["id"],)).fetchone()
            self.assertEqual(row["status"], "queued")
            self.assertGreater(row["available_at"], int(__import__("time").time()))
            c.execute("UPDATE collector_jobs SET available_at=0 WHERE id=?", (job["id"],))
        queue.claim_job("worker-b")
        self.assertTrue(queue.fail_job(job["id"], "worker-b", "NetworkError"))
        with queue.connect() as c:
            row = c.execute("SELECT status FROM collector_jobs WHERE id=?", (job["id"],)).fetchone()
        self.assertEqual(row["status"], "failed")
        with queue.connect() as c:
            events = [row["event"] for row in c.execute(
                "SELECT event FROM collector_job_events WHERE job_id=? ORDER BY created_at,id",
                (job["id"],),
            ).fetchall()]
        self.assertIn("retry_scheduled", events)
        self.assertIn("dead_letter", events)

    def test_fail_job_does_not_overwrite_cancel_requested_job(self):
        job = queue.submit_job("crawl", {"url": "https://example.org"}, "cancel-fail-race:test")
        queue.claim_job("worker-a")
        self.assertTrue(queue.cancel_job(job["id"]))
        self.assertFalse(queue.fail_job(job["id"], "worker-a", "late worker error"))
        with queue.connect() as c:
            row = c.execute("SELECT status,lease_owner FROM collector_jobs WHERE id=?", (job["id"],)).fetchone()
        self.assertEqual(row["status"], "cancel_requested")
        self.assertEqual(row["lease_owner"], "worker-a")

    def test_cancel_queued_job(self):
        job = queue.submit_job("crawl", {"url": "https://example.org"}, "cancel:test")
        self.assertTrue(queue.cancel_job(job["id"]))
        self.assertIsNone(queue.claim_job("worker-a"))

    def test_running_job_cancel_is_cooperative_and_recoverable(self):
        job = queue.submit_job("crawl", {"url": "https://example.org"}, "cancel-running:test")
        queue.claim_job("worker-a")
        self.assertTrue(queue.cancel_job(job["id"]))
        self.assertTrue(queue.job_cancelled(job["id"]))
        self.assertTrue(queue.mark_cancelled(job["id"], "worker-a"))
        with queue.connect() as c:
            row = c.execute("SELECT status FROM collector_jobs WHERE id=?", (job["id"],)).fetchone()
        self.assertEqual(row["status"], "cancelled")
        with queue.connect() as c:
            events = [row["event"] for row in c.execute(
                "SELECT event FROM collector_job_events WHERE job_id=? ORDER BY created_at,id",
                (job["id"],),
            ).fetchall()]
        self.assertIn("cancel_requested", events)
        self.assertGreaterEqual(events.count("cancelled"), 1)

    def test_registry_search_miss_enqueues_fmhy_discovery(self):
        with patch.object(queue, "require_auth"):
            result = queue.api_registry_search(q="Missing film", authorization="Bearer test")
        self.assertEqual(result["resources"], [])
        self.assertEqual(len(result["queued"]), 1)
        self.assertEqual(result["queued"][0]["stage"], "fmhy_discovery")
        with queue.connect() as c:
            job = c.execute("SELECT job_type,status FROM collector_jobs").fetchone()
        self.assertEqual(job["job_type"], "discover")
        self.assertEqual(job["status"], "queued")

    def test_registry_upsert_is_idempotent_and_title_is_not_identity(self):
        one = queue.upsert_resource({
            "resource_key": "provider-a:movie-1", "source_key": "provider-a",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/a.mp4",
            "title": "同名电影", "movie_external_key": "tmdb:100",
        })
        again = queue.upsert_resource({
            "resource_key": "provider-a:movie-1", "source_key": "provider-a",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/a.mp4",
            "title": "同名电影", "movie_external_key": "tmdb:100",
        })
        other = queue.upsert_resource({
            "resource_key": "provider-a:movie-2", "source_key": "provider-a",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/b.mp4",
            "title": "同名电影", "movie_external_key": "tmdb:200",
        })
        self.assertEqual(one["id"], again["id"])
        self.assertNotEqual(one["movie_id"], other["movie_id"])

    def test_registry_library_paginates_all_resources_including_unverified(self):
        created = []
        for index in range(3):
            created.append(queue.upsert_resource({
                "resource_key": f"resource:library-{index}", "source_key": "fmhy",
                "resource_type": "DIRECT_MEDIA", "url": f"https://media.example.org/{index}.m3u8",
                "title": f"Library Film {index}", "access_state": "PUBLIC" if index == 0 else "ACCESS_UNKNOWN",
            }))
        queue.record_verification(created[0]["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(created[0]["id"], "player", "passed", {"progressed_seconds": 3})
        with patch.object(queue, "require_auth"):
            first = queue.api_search_resources(verified_only=False, limit=2, offset=0, authorization="Bearer test")
            second = queue.api_search_resources(verified_only=False, limit=2, offset=2, authorization="Bearer test")
            verified = queue.api_search_resources(verified_only=True, limit=2, offset=0, authorization="Bearer test")
            searched = queue.api_search_resources(q="Library Film 1", verified_only=False, limit=2, offset=0, authorization="Bearer test")
        self.assertEqual(len(first["resources"]), 2)
        self.assertTrue(first["has_more"])
        self.assertEqual(len(second["resources"]), 1)
        self.assertFalse(second["has_more"])
        self.assertEqual(first["total"], 3)
        self.assertEqual(verified["total"], 1)
        self.assertFalse(verified["has_more"])
        self.assertEqual(searched["total"], 1)
        self.assertFalse(searched["has_more"])

    def test_registry_preserves_public_query_but_rejects_signed_urls(self):
        resource = queue.upsert_resource({
            "resource_key": "resource:public-query", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA",
            "url": "https://Media.Example.org/movie.m3u8?quality=1080p&format=hls#player",
            "title": "Example Film",
        })
        self.assertEqual(resource["url"], "https://media.example.org/movie.m3u8?quality=1080p&format=hls")
        for unsafe_url in (
            "http://media.example.org/movie.mp4",
            "https://user:password@media.example.org/movie.mp4",
            "https://media.example.org:8443/movie.mp4",
            "https://media.example.org/movie.m3u8?token=secret",
            "https://media.example.org/movie.m3u8?X-Amz-Signature=secret",
        ):
            with self.subTest(url=unsafe_url):
                with self.assertRaises(ValueError):
                    queue.upsert_resource({
                        "resource_key": "unsafe:" + str(abs(hash(unsafe_url))),
                        "source_key": "provider", "resource_type": "DIRECT_MEDIA",
                        "url": unsafe_url, "title": "Unsafe",
                    })

    def test_playback_requires_public_preflight(self):
        resource = queue.upsert_resource({
            "resource_key": "resource:private", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/a.mp4",
            "title": "Private", "access_state": "AUTH_REQUIRED",
        })
        with self.assertRaises(ValueError):
            queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})

    def test_verification_history_and_confirmed_registry_search(self):
        resource = queue.upsert_resource({
            "resource_key": "resource:public", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/a.mp4",
            "title": "Public Film", "access_state": "PUBLIC",
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        with queue.connect() as c:
            row = c.execute("SELECT validation_state,playback_state FROM registry_resources WHERE id=?", (resource["id"],)).fetchone()
            history = c.execute("SELECT COUNT(*) n FROM registry_history WHERE resource_id=?", (resource["id"],)).fetchone()["n"]
            verifications = c.execute("SELECT COUNT(*) n FROM registry_verifications WHERE resource_id=?", (resource["id"],)).fetchone()["n"]
        self.assertEqual(row["validation_state"], "validated")
        self.assertEqual(row["playback_state"], "PLAYER_CONFIRMED")
        self.assertGreaterEqual(history, 3)
        self.assertEqual(verifications, 2)


    def test_registry_search_exposes_public_validated_media_before_first_playback(self):
        resource = queue.upsert_resource({
            "resource_key": "candidate:public-media", "source_key": "public-provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/film.m3u8",
            "title": "Public Film", "access_state": "PUBLIC", "media_format": "hls",
            "candidate_id": "a" * 32,
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        with patch.object(queue, "require_auth"):
            result = queue.api_registry_search(q="Public Film", authorization="Bearer test")
        self.assertEqual(len(result["resources"]), 1)
        self.assertEqual(result["resources"][0]["playback_state"], "unverified")
        self.assertEqual(result["resources"][0]["candidate_id"], "a" * 32)
        self.assertEqual(result["queued"], [])
        self.assertEqual(result["search_mode"], "playback_eligible_registry")

    def test_registry_search_does_not_expose_unvalidated_or_non_media_candidates(self):
        resource = queue.upsert_resource({
            "resource_key": "candidate:cms-api", "source_key": "public-provider",
            "resource_type": "CMS_VOD", "url": "https://api.example.org/provide/vod",
            "title": "Public Film", "access_state": "PUBLIC",
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        with patch.object(queue, "require_auth"):
            result = queue.api_registry_search(q="Public Film", authorization="Bearer test")
        self.assertEqual(result["resources"], [])
        self.assertEqual(len(result["queued"]), 1)
        self.assertEqual(result["queued"][0]["stage"], "fmhy_discovery")



    def test_signed_candidate_is_not_promoted_into_durable_registry(self):
        candidate_id = "c" * 32
        result = queue.register_discovered_candidate({
            "id": candidate_id,
            "kind": "direct-media",
            "host": "media.example.org",
            "url": "https://media.example.org/movie.m3u8?token=ephemeral-secret",
            "title": "Signed Film",
            "status": "pending",
            "access_state": "ACCESS_UNKNOWN",
        })
        self.assertIsNone(result)
        with queue.connect() as c:
            stored = c.execute(
                "SELECT id FROM registry_resources WHERE candidate_id=?",
                (candidate_id,),
            ).fetchone()
        self.assertIsNone(stored)

    def test_registry_identity_cannot_be_overridden_by_caller_key(self):
        common = {
            "source_key": "same-provider", "resource_type": "DIRECT_MEDIA",
            "url": "https://media.example.org/stable/movie.mp4", "title": "Same film",
        }
        first = queue.upsert_resource({**common, "resource_key": "caller-key-one"})
        second = queue.upsert_resource({**common, "resource_key": "caller-key-two"})
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["resource_key"], second["resource_key"])

    def test_candidate_links_deduplicate_by_source_and_canonical_url(self):
        url = "https://media.example.org/catalog/movie.mp4"
        first_id = "1" * 32
        second_id = "2" * 32
        first = queue.register_discovered_candidate({
            "id": first_id, "kind": "direct-media", "host": "media.example.org",
            "url": url, "title": "Same public media", "status": "pending",
            "access_state": "ACCESS_UNKNOWN",
        })
        second = queue.register_discovered_candidate({
            "id": second_id, "kind": "direct-media", "host": "media.example.org",
            "url": url, "title": "Same public media", "status": "pending",
            "access_state": "ACCESS_UNKNOWN",
        })
        self.assertEqual(first["id"], second["id"])
        self.assertNotEqual(first["resource_key"], "candidate:" + first_id)
        with queue.connect() as connection:
            links = connection.execute(
                "SELECT COUNT(*) AS n FROM registry_candidate_links WHERE resource_id=?",
                (first["id"],),
            ).fetchone()["n"]
        self.assertEqual(links, 2)

        queue.sync_candidate_validation(first_id, {
            "reachable": True, "media_format": "progressive",
            "content_type": "video/mp4", "access": {"access_state": "PUBLIC"},
        }, "validated")
        confirmed = queue.register_candidate_playback(second_id, {
            "progressed_seconds": 15, "observed_seconds": 15, "media_type": "mp4",
        })
        self.assertEqual(confirmed["resource"]["id"], first["id"])
        self.assertEqual(confirmed["resource"]["playback_state"], "PLAYER_CONFIRMED")

    def test_registry_search_matches_preserved_search_keyword_metadata(self):
        candidate_id = "b" * 32
        resource = queue.register_discovered_candidate({
            "id": candidate_id,
            "kind": "direct-media",
            "host": "loc.gov",
            "url": "https://loc.gov/resource/sample.mp4",
            "title": "Library of Congress",
            "status": "pending",
            "search_keyword": "The Sample Film",
            "access_state": "ACCESS_UNKNOWN",
        })
        queue.sync_candidate_validation(candidate_id, {
            "reachable": True,
            "media_format": "progressive",
            "content_type": "video/mp4",
            "access": {"access_state": "PUBLIC"},
        }, "validated")
        with patch.object(queue, "require_auth"):
            result = queue.api_registry_search(q="Sample Film", authorization="Bearer test")
        self.assertEqual([item["candidate_id"] for item in result["resources"]], [candidate_id])
        self.assertEqual(result["queued"], [])



if __name__ == "__main__":
    unittest.main()
