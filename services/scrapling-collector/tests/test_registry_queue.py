import asyncio
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
        with queue.connect() as c:
            c.execute("CREATE TABLE IF NOT EXISTS sites (host TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, directory TEXT NOT NULL, discovered_at INTEGER NOT NULL)")

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_discovered_site_allowlist_is_read_only_and_bounded(self):
        with queue.connect() as c:
            c.execute(
                "INSERT INTO sites(host,title,url,directory,discovered_at) VALUES(?,?,?,?,?)",
                ("catalog.example.org", "Catalog", "https://catalog.example.org/", "FMHY", 123),
            )
        with patch.object(queue, "require_auth"):
            result = queue.api_sites(authorization="Bearer test", limit=10)
        self.assertEqual(len(result["sites"]), 1)
        self.assertEqual(result["sites"][0]["host"], "catalog.example.org")
        self.assertEqual(result["sites"][0]["url"], "https://catalog.example.org/")


    def test_discovery_jobs_are_durable_and_idempotent(self):
        first = queue.submit_job("discover", {"search_keyword": "sample"}, "discover:sample")
        second = queue.submit_job("discover", {"search_keyword": "sample"}, "discover:sample")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["job_type"], "discover")

    def test_seedhub_collection_job_types_are_rejected_by_api(self):
        from fastapi import HTTPException
        for job_type in ("seedhub_sync", "seedhub_detail_sync", "dv_media_ingest"):
            with self.subTest(job_type=job_type), patch.object(queue, "require_auth"), self.assertRaises(HTTPException):
                queue.api_submit_job(
                    {"job_type": job_type, "payload": {"category": "movies"}, "idempotency_key": "retired:" + job_type},
                    authorization="Bearer test",
                )

    def test_idempotent_job_submit_and_atomic_claim(self):
        first = queue.submit_job("crawl", {"url": "https://example.org"}, "crawl:example")
        second = queue.submit_job("crawl", {"url": "https://example.org"}, "crawl:example")
        self.assertEqual(first["id"], second["id"])
        claimed = queue.claim_job("worker-a", lease_seconds=30)
        self.assertEqual(claimed["attempt"], 1)
        self.assertIsNone(queue.claim_job("worker-b"))

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

    def test_dolby_vision_asset_registry_is_content_addressed_and_immutable(self):
        resource = queue.upsert_resource({
            "resource_key": "resource:dv", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/a.mp4",
            "title": "DV candidate", "access_state": "PUBLIC", "media_format": "mp4",
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        digest = "a" * 64
        first = queue.register_dolby_vision_media_asset(
            resource["id"], digest, 123456, "video/mp4"
        )
        again = queue.register_dolby_vision_media_asset(
            resource["id"], digest.upper(), 123456, "video/mp4"
        )
        self.assertEqual(first["asset_id"], again["asset_id"])
        self.assertEqual(first["object_key"], f"sha256/aa/{digest}")
        self.assertEqual(first["sha256"], digest)
        with self.assertRaises(ValueError):
            queue.register_dolby_vision_media_asset(
                resource["id"], digest, 123457, "video/mp4"
            )
        other_resource = queue.upsert_resource({
            "resource_key": "resource:dv-copy", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/copy.mp4",
            "title": "Same bytes", "access_state": "PUBLIC", "media_format": "mp4",
        })
        queue.record_verification(other_resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(other_resource["id"], "player", "passed", {"progressed_seconds": 3})
        shared = queue.register_dolby_vision_media_asset(
            other_resource["id"], digest, 123456, "video/mp4"
        )
        self.assertEqual(shared["object_key"], first["object_key"])
        self.assertNotEqual(shared["asset_id"], first["asset_id"])
        with self.assertRaises(ValueError):
            queue.register_dolby_vision_media_asset(
                resource["id"], "not-a-digest", 123456, "video/mp4"
            )
        with self.assertRaises(ValueError):
            queue.register_dolby_vision_media_asset(
                resource["id"], "b" * 64, 123456, "text/html"
            )

    def test_dolby_vision_immutable_asset_supports_single_http_byte_ranges(self):
        from fastapi import HTTPException
        from pathlib import Path

        resource = queue.upsert_resource({
            "resource_key": "resource:range", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/range.mp4",
            "title": "Range fixture", "access_state": "PUBLIC", "media_format": "mp4",
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        body = b"0123456789"
        digest = __import__("hashlib").sha256(body).hexdigest()
        asset = queue.register_dolby_vision_media_asset(
            resource["id"], digest, len(body), "video/mp4"
        )
        object_root = Path(self.tmp.name) / "objects"
        object_path = object_root / asset["object_key"]
        object_path.parent.mkdir(parents=True)
        object_path.write_bytes(body)

        async def consume(response):
            return b"".join([chunk async for chunk in response.body_iterator])

        with patch.object(queue, "DV_MEDIA_OBJECT_ROOT", object_root), patch.object(queue, "require_auth"):
            partial = queue.api_get_dolby_vision_media_asset_content(
                asset["asset_id"], authorization="Bearer test", range_header="bytes=2-5"
            )
            self.assertEqual(partial.status_code, 206)
            self.assertEqual(partial.headers["content-range"], "bytes 2-5/10")
            self.assertEqual(partial.headers["content-length"], "4")
            self.assertEqual(partial.headers["accept-ranges"], "bytes")
            self.assertEqual(asyncio.run(consume(partial)), b"2345")

            open_ended = queue.api_get_dolby_vision_media_asset_content(
                asset["asset_id"], authorization="Bearer test", range_header="bytes=7-"
            )
            self.assertEqual(asyncio.run(consume(open_ended)), b"789")

            suffix = queue.api_get_dolby_vision_media_asset_content(
                asset["asset_id"], authorization="Bearer test", range_header="bytes=-3"
            )
            self.assertEqual(asyncio.run(consume(suffix)), b"789")

            full = queue.api_get_dolby_vision_media_asset_content(
                asset["asset_id"], authorization="Bearer test"
            )
            self.assertEqual(full.status_code, 200)
            self.assertEqual(asyncio.run(consume(full)), body)

            # A mutation after the digest check but before the response body is
            # consumed must not leak bytes under the original asset identity.
            changed_after_open = queue.api_get_dolby_vision_media_asset_content(
                asset["asset_id"], authorization="Bearer test", range_header="bytes=0-3"
            )
            object_path.write_bytes(b"abcdefghij")
            with self.assertRaises(HTTPException) as changed:
                asyncio.run(consume(changed_after_open))
            self.assertEqual(changed.exception.status_code, 409)
            object_path.write_bytes(body)
            queue._DV_VERIFIED_OBJECTS.clear()

            for invalid in ("bytes=10-", "bytes=8-2", "bytes=-0", "bytes=0-1,4-5", "items=0-1"):
                with self.subTest(invalid=invalid), self.assertRaises(HTTPException) as raised:
                    queue.api_get_dolby_vision_media_asset_content(
                        asset["asset_id"], authorization="Bearer test", range_header=invalid
                    )
                self.assertEqual(raised.exception.status_code, 416)
                self.assertEqual(raised.exception.headers["Content-Range"], "bytes */10")

    def test_dolby_vision_asset_registration_requires_separate_ingestion_secret(self):
        from fastapi import HTTPException
        with patch.object(queue, "DV_INGESTION_TOKEN", "dedicated-ingest-secret"):
            with self.assertRaises(HTTPException):
                queue.require_dv_ingestion_auth("collector-api-token")
            queue.require_dv_ingestion_auth("dedicated-ingest-secret")

    def test_dolby_vision_asset_registration_api_uses_dedicated_secret_and_returns_binding(self):
        from unittest.mock import patch
        resource = queue.upsert_resource({
            "resource_key": "resource:dv-api", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/dv.mp4",
            "title": "DV API", "access_state": "PUBLIC", "media_format": "mp4",
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        payload = queue.DolbyVisionMediaAssetRegistration(
            sha256="c" * 64, byte_length=456789, content_type="video/mp4"
        )
        with patch.object(queue, "DV_INGESTION_TOKEN", "ingest-only-secret"):
            result = queue.api_register_dv_media_asset(
                resource["id"], payload, x_dv_ingestion_token="ingest-only-secret"
            )
        with patch.object(queue, "require_auth"):
            detail = queue.api_get_resource(resource["id"], authorization="Bearer collector")
        self.assertEqual(result["asset"]["asset_id"], detail["media_assets"][0]["asset_id"])
        self.assertEqual(detail["media_assets"][0]["sha256"], "c" * 64)

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



    def test_initialize_cancels_legacy_seedhub_collection_jobs(self):
        now = int(__import__("time").time())
        legacy = ("seedhub_sync", "seedhub_detail_sync")
        with queue.connect() as c:
            for index, job_type in enumerate(legacy):
                c.execute(
                    """INSERT INTO collector_jobs
                       (id,idempotency_key,job_type,payload,status,available_at,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,?,?)""",
                    (f"legacy-{index}", f"legacy:{job_type}", job_type, "{}", "queued", now, now, now),
                )
        queue.initialize()
        with queue.connect() as c:
            rows = c.execute(
                "SELECT id,status,lease_owner,lease_until,cancelled_at FROM collector_jobs WHERE id LIKE 'legacy-%' ORDER BY id"
            ).fetchall()
            events = c.execute(
                "SELECT COUNT(*) AS n FROM collector_job_events WHERE event='seedhub_collection_retired'"
            ).fetchone()["n"]
        self.assertEqual([row["status"] for row in rows], ["cancelled", "cancelled"])
        self.assertTrue(all(row["lease_owner"] is None and row["lease_until"] is None for row in rows))
        self.assertTrue(all(row["cancelled_at"] is not None for row in rows))
        self.assertEqual(events, 2)

    def test_seedhub_collection_job_types_are_rejected(self):
        for job_type in ("seedhub_sync", "seedhub_detail_sync"):
            with self.subTest(job_type=job_type), self.assertRaises(ValueError):
                queue.submit_job(job_type, {"category": "movies"}, "retired:" + job_type)




    def test_hls_graph_api_returns_ordered_trusted_init_and_segment_members(self):
        from fastapi import HTTPException
        import hashlib
        from pathlib import Path
        resource = queue.upsert_resource({
            "resource_key": "resource:hls-graph-api", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/master.m3u8",
            "title": "HLS graph fixture", "access_state": "PUBLIC", "media_format": "hls",
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        payloads = [
            ("root", b"#EXTM3U\\nvariant.m3u8\\n", "application/vnd.apple.mpegurl"),
            ("variant", b'#EXTM3U\\n#EXT-X-MAP:URI="init.mp4"\\n#EXTINF:4,\\nseg.m4s\\n#EXT-X-ENDLIST\\n', "application/vnd.apple.mpegurl"),
            ("init", b"init-bytes", "video/mp4"),
            ("segment", b"segment-bytes", "video/iso.segment"),
        ]
        assets = []
        for label, body, content_type in payloads:
            digest = hashlib.sha256(body).hexdigest()
            asset = queue.register_dolby_vision_media_asset(resource["id"], digest, len(body), content_type)
            assets.append(asset)
        with queue.connect() as c:
            c.execute(
                "INSERT INTO registry_hls_asset_graphs(graph_id,resource_id,root_asset_id,created_at) VALUES(?,?,?,?)",
                ("hls-graph-api", resource["id"], assets[0]["asset_id"], 10),
            )
            c.executemany(
                """INSERT INTO registry_hls_asset_edges(parent_asset_id,child_asset_id,relative_uri,role,ordinal)
                   VALUES(?,?,?,?,?)""",
                [
                    (assets[0]["asset_id"], assets[1]["asset_id"], "variant.m3u8", "playlist", 0),
                    (assets[1]["asset_id"], assets[2]["asset_id"], "init.mp4", "initialization", 0),
                    (assets[1]["asset_id"], assets[3]["asset_id"], "seg.m4s", "segment", 1),
                ],
            )
        with patch.object(queue, "require_auth"):
            result = queue.api_get_hls_asset_graph(resource["id"], authorization="Bearer test")
        self.assertEqual(result["rootAsset"]["assetId"], assets[0]["asset_id"])
        self.assertEqual({item["assetId"] for item in result["members"]}, {a["asset_id"] for a in assets[1:]})
        self.assertEqual([edge["role"] for edge in result["edges"]], ["playlist", "initialization", "segment"])
        self.assertEqual(result["edges"][-1]["childAssetId"], assets[3]["asset_id"])
        self.assertTrue(all(item["resourceId"] == resource["id"] for item in result["members"]))

    def test_hls_graph_api_fails_closed_for_unverified_resources_and_missing_graphs(self):
        from fastapi import HTTPException
        resource = queue.upsert_resource({
            "resource_key": "resource:hls-graph-unverified", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/master.m3u8",
            "title": "Unverified HLS", "access_state": "PUBLIC", "media_format": "hls",
        })
        with patch.object(queue, "require_auth"), self.assertRaises(HTTPException) as blocked:
            queue.api_get_hls_asset_graph(resource["id"], authorization="Bearer test")
        self.assertEqual(blocked.exception.status_code, 409)
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        with patch.object(queue, "require_auth"), self.assertRaises(HTTPException) as missing:
            queue.api_get_hls_asset_graph(resource["id"], authorization="Bearer test")
        self.assertEqual(missing.exception.status_code, 404)


    def test_cms_asset_binding_requires_exact_provider_episode_and_playback_hashes(self):
        from fastapi import HTTPException
        resource = queue.upsert_resource({
            "resource_key": "resource:cms-binding-exact", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/asset.mp4",
            "title": "Verified MP4", "access_state": "PUBLIC", "media_format": "mp4",
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        digest = "a" * 64
        asset = queue.register_dolby_vision_media_asset(resource["id"], digest, 1234, "video/mp4")
        binding = queue.CmsAssetBindingRegistration(
            source_key="custom_1", vod_id="167277", episode_index=0,
            provider_url_sha256="b" * 64, playback_url_sha256="c" * 64,
            resource_id=resource["id"], asset_id=asset["asset_id"],
        )
        with patch.object(queue, "require_dv_ingestion_auth"):
            created = queue.api_register_cms_asset_binding(binding, x_dv_ingestion_token="operator")
        self.assertEqual(created["status"], "bound")
        with patch.object(queue, "require_auth"):
            found = queue.api_get_cms_asset_binding(
                source_key="custom_1", vod_id="167277", episode_index=0,
                provider_url_sha256="b" * 64, playback_url_sha256="c" * 64,
                authorization="Bearer test",
            )
            with self.assertRaises(HTTPException) as mismatch:
                queue.api_get_cms_asset_binding(
                    source_key="custom_1", vod_id="167277", episode_index=0,
                    provider_url_sha256="b" * 64, playback_url_sha256="d" * 64,
                    authorization="Bearer test",
                )
        self.assertEqual(found["assetId"], asset["asset_id"])
        self.assertEqual(found["sha256"], digest)
        self.assertEqual(found["rpuPresence"], "unknown")
        self.assertEqual(mismatch.exception.status_code, 404)

    def test_cms_hls_binding_requires_an_exact_registered_graph_root_and_revokes_cleanly(self):
        from fastapi import HTTPException
        resource = queue.upsert_resource({
            "resource_key": "resource:cms-hls-root", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/master.m3u8",
            "title": "Verified HLS", "access_state": "PUBLIC", "media_format": "hls",
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        root = queue.register_dolby_vision_media_asset(
            resource["id"], "1" * 64, 512, "application/vnd.apple.mpegurl")
        other = queue.register_dolby_vision_media_asset(
            resource["id"], "2" * 64, 256, "application/vnd.apple.mpegurl")
        payload = queue.CmsAssetBindingRegistration(
            source_key="custom_1", vod_id="167277", episode_index=0,
            provider_url_sha256="b" * 64, playback_url_sha256="c" * 64,
            resource_id=resource["id"], asset_id=root["asset_id"],
        )
        with patch.object(queue, "require_dv_ingestion_auth"), self.assertRaises(HTTPException) as no_graph:
            queue.api_register_cms_asset_binding(payload, x_dv_ingestion_token="operator")
        self.assertEqual(no_graph.exception.status_code, 409)
        with queue.connect() as c:
            c.execute(
                "INSERT INTO registry_hls_asset_graphs(graph_id,resource_id,root_asset_id,created_at) VALUES(?,?,?,?)",
                (root["asset_id"], resource["id"], root["asset_id"], 123),
            )
        with patch.object(queue, "require_dv_ingestion_auth"), self.assertRaises(HTTPException) as empty_graph:
            queue.api_register_cms_asset_binding(payload, x_dv_ingestion_token="operator")
        self.assertEqual(empty_graph.exception.status_code, 409)
        member = queue.register_dolby_vision_media_asset(
            resource["id"], "3" * 64, 4096, "video/iso.segment")
        with queue.connect() as c:
            c.execute(
                """INSERT INTO registry_hls_asset_edges
                   (parent_asset_id,child_asset_id,relative_uri,role,ordinal) VALUES(?,?,?,?,?)""",
                (root["asset_id"], member["asset_id"], "segment0.m4s", "segment", 0),
            )
        with patch.object(queue, "require_dv_ingestion_auth"):
            result = queue.api_register_cms_asset_binding(payload, x_dv_ingestion_token="operator")
            self.assertEqual(result["status"], "bound")
            with self.assertRaises(HTTPException) as wrong_root:
                queue.api_register_cms_asset_binding(
                    payload.model_copy(update={"asset_id": other["asset_id"]}),
                    x_dv_ingestion_token="operator",
                )
            self.assertEqual(wrong_root.exception.status_code, 409)
        args = dict(
            source_key="custom_1", vod_id="167277", episode_index=0,
            provider_url_sha256="b" * 64, playback_url_sha256="c" * 64,
            authorization="Bearer test",
        )
        with patch.object(queue, "require_auth"):
            found = queue.api_get_cms_asset_binding(**args)
            self.assertEqual(found["mediaType"], "hls")
            self.assertEqual(found["graphId"], root["asset_id"])
            self.assertEqual(found["rpuPresence"], "unknown")
            with self.assertRaises(HTTPException) as wrong_hash:
                queue.api_get_cms_asset_binding(**{**args, "playback_url_sha256": "d" * 64})
            self.assertEqual(wrong_hash.exception.status_code, 404)
            with queue.connect() as c:
                c.execute("DELETE FROM registry_hls_asset_graphs WHERE root_asset_id=?", (root["asset_id"],))
            with self.assertRaises(HTTPException) as revoked:
                queue.api_get_cms_asset_binding(**args)
            self.assertEqual(revoked.exception.status_code, 409)

    def test_cms_asset_binding_rejects_unverified_and_conflicting_assets(self):
        from fastapi import HTTPException
        resource = queue.upsert_resource({
            "resource_key": "resource:cms-binding-unverified", "source_key": "provider",
            "resource_type": "DIRECT_MEDIA", "url": "https://media.example.org/asset.mp4",
            "title": "Verified MP4 before revocation", "access_state": "PUBLIC", "media_format": "mp4",
        })
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        asset = queue.register_dolby_vision_media_asset(resource["id"], "e" * 64, 1234, "video/mp4")
        with queue.connect() as c:
            c.execute("UPDATE registry_resources SET validation_state='unverified' WHERE id=?", (resource["id"],))
        binding = queue.CmsAssetBindingRegistration(
            source_key="custom_1", vod_id="167277", episode_index=0,
            provider_url_sha256="b" * 64, playback_url_sha256="c" * 64,
            resource_id=resource["id"], asset_id=asset["asset_id"],
        )
        with patch.object(queue, "require_dv_ingestion_auth"), self.assertRaises(HTTPException) as blocked:
            queue.api_register_cms_asset_binding(binding, x_dv_ingestion_token="operator")
        self.assertEqual(blocked.exception.status_code, 409)
        queue.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 3})
        second_asset = queue.register_dolby_vision_media_asset(resource["id"], "f" * 64, 2345, "video/mp4")
        with patch.object(queue, "require_dv_ingestion_auth"):
            queue.api_register_cms_asset_binding(binding, x_dv_ingestion_token="operator")
            conflicting = binding.model_copy(update={"asset_id": second_asset["asset_id"]})
            with self.assertRaises(HTTPException) as conflict:
                queue.api_register_cms_asset_binding(conflicting, x_dv_ingestion_token="operator")
        self.assertEqual(conflict.exception.status_code, 409)

if __name__ == "__main__":
    unittest.main()
