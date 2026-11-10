import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("SCRAPLING_DB_PATH", "/tmp/libretv-registry-import.sqlite3")
import registry_store as registry


class RegistryStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        registry.DB_PATH = Path(self.temp.name) / "registry.sqlite3"
        registry.init()

    def tearDown(self):
        self.temp.cleanup()

    def test_enqueue_is_idempotent_and_claim_is_atomic(self):
        first = registry.enqueue("https://catalog.example/list", "http", "same-request-key")
        second = registry.enqueue("https://catalog.example/list", "http", "same-request-key")
        self.assertEqual(first["id"], second["id"])
        claimed = registry.claim("worker-a", 60)
        self.assertEqual(claimed["id"], first["id"])
        self.assertEqual(claimed["attempts"], 1)
        self.assertIsNone(registry.claim("worker-b", 60))

    def test_failed_job_retries_with_backoff_and_then_dead_letters(self):
        job = registry.enqueue("https://catalog.example/list", "http", "retry-key")
        claimed = registry.claim("worker-a", 60)
        queued = registry.finish(job["id"], "worker-a", "failed", error="temporary")
        self.assertEqual(queued["status"], "queued")
        self.assertGreater(queued["available_at"], queued["updated_at"])
        # Make the delayed job immediately eligible for deterministic retry.
        with registry.connect() as c:
            c.execute("UPDATE collector_jobs SET available_at=0,max_attempts=2 WHERE id=?", (job["id"],))
        registry.claim("worker-a", 60)
        dead = registry.finish(job["id"], "worker-a", "failed", error="terminal")
        self.assertEqual(dead["status"], "failed")

    def test_worker_cannot_finish_another_workers_lease(self):
        job = registry.enqueue("https://catalog.example/list", "http", "lease-key")
        registry.claim("worker-a", 60)
        with self.assertRaises(PermissionError):
            registry.finish(job["id"], "worker-b", "succeeded")

    def test_registry_deduplicates_by_source_and_canonical_url_not_title(self):
        one = registry.upsert_resource("site-a", "Site A",
            "https://cdn.example/movie.mp4?token=secret", "DIRECT_MEDIA", "Same title")
        again = registry.upsert_resource("site-a", "Site A",
            "https://cdn.example/movie.mp4?other=credential", "DIRECT_MEDIA", "Same title")
        other_source = registry.upsert_resource("site-b", "Site B",
            "https://cdn.example/movie.mp4", "DIRECT_MEDIA", "Same title")
        self.assertEqual(one["id"], again["id"])
        self.assertNotEqual(one["id"], other_source["id"])
        self.assertNotIn("secret", one["canonical_url"])

    def test_same_title_movies_are_not_merged_without_external_identity(self):
        a = registry.upsert_resource("site-a", "Site A", "https://cdn.example/a.mp4",
            "DIRECT_MEDIA", "Twin")
        b = registry.upsert_resource("site-a", "Site A", "https://cdn.example/b.mp4",
            "DIRECT_MEDIA", "Twin")
        self.assertNotEqual(a["id"], b["id"])

    def test_playback_confirmation_requires_public_validated_resource(self):
        resource = registry.upsert_resource("site-a", "Site A", "https://cdn.example/a.mp4",
            "DIRECT_MEDIA", "Movie", access_state="PUBLIC", validation_state="validated")
        confirmed = registry.record_playback(resource["id"], {
            "state": "PLAYER_CONFIRMED", "progressed_seconds": 3.1, "media_type": "mp4"
        })
        self.assertEqual(confirmed["playback_state"], "PLAYER_CONFIRMED")
        blocked = registry.upsert_resource("site-a", "Site A", "https://cdn.example/b.mp4",
            "DIRECT_MEDIA", "Restricted", access_state="AUTH_REQUIRED", validation_state="validated")
        with self.assertRaises(PermissionError):
            registry.record_playback(blocked["id"], {
                "state": "PLAYER_CONFIRMED", "progressed_seconds": 3.1, "media_type": "mp4"
            })

    def test_resource_url_rejects_credentials_and_non_https(self):
        with self.assertRaises(ValueError):
            registry.upsert_resource("site", "Site", "http://cdn.example/a.mp4", "DIRECT_MEDIA")
        with self.assertRaises(ValueError):
            registry.upsert_resource("site", "Site", "https://user:pass@cdn.example/a.mp4", "DIRECT_MEDIA")


if __name__ == "__main__":
    unittest.main()
