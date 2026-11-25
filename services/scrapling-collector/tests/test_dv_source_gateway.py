import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

os.environ.setdefault("SCRAPLING_API_TOKEN", "collector-test-token")
os.environ.setdefault("SCRAPLING_DB_PATH", str(Path(tempfile.gettempdir()) / "libretv-scrapling-tests.sqlite3"))

import app as collector
import registry_queue
from dv_source_gateway import ingest_authorized_candidate


class AuthorizedProgressiveSourceGatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_paths = (
            collector.DB_PATH, registry_queue.DB_PATH,
            registry_queue.DV_MEDIA_OBJECT_ROOT, registry_queue.DV_MEDIA_STAGING_ROOT,
        )
        self.db_path = Path(self.temp.name) / "collector.sqlite3"
        collector.DB_PATH = self.db_path
        registry_queue.DB_PATH = self.db_path
        collector.init_db()
        registry_queue.initialize()
        self.object_root = Path(self.temp.name) / "objects"
        self.staging_root = Path(self.temp.name) / "staging"
        registry_queue.DV_MEDIA_OBJECT_ROOT = self.object_root
        registry_queue.DV_MEDIA_STAGING_ROOT = self.staging_root
        self.staging_root.mkdir()
        self.candidate_id = "c" * 32
        now = 1_800_000_020
        validation = {
            "reachable": True,
            "media_format": "progressive",
            "content_type": "video/mp4",
            "final_url": "https://media.example/asset.mp4",
            "access": {"access_state": "PUBLIC"},
        }
        with collector.db() as db:
            db.execute(
                "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                ("d" * 32, "https://media.example/asset.mp4", "media.example", "completed", "http", now, now),
            )
            db.execute(
                """INSERT INTO candidates
                   (id,task_id,url,host,kind,title,status,created_at,access_state,validation,playback_verification)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (self.candidate_id, "d" * 32, "https://media.example/asset.mp4",
                 "media.example", "direct-media", "Authorized progressive test",
                 "validated", now, "PUBLIC", json.dumps(validation), "{}"),
            )
        with patch.dict(os.environ, {
            "DV_SOURCE_GATEWAY_ENABLED": "0",
            "SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "1",
        }), patch.object(collector, "require_token"):
            self.playback_result = collector.record_playback_evidence(
                self.candidate_id,
                collector.PlaybackEvidence(
                    media_type="mp4", observed_seconds=5, progressed_seconds=4.0
                ),
                "Bearer test",
            )
        self.resource_id = self.playback_result["resource"]["id"]

    def tearDown(self):
        (
            collector.DB_PATH, registry_queue.DB_PATH,
            registry_queue.DV_MEDIA_OBJECT_ROOT, registry_queue.DV_MEDIA_STAGING_ROOT,
        ) = self.previous_paths
        self.temp.cleanup()

    @staticmethod
    def public_url(value):
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("unsafe test URL")
        return value, parsed.hostname.lower()

    @staticmethod
    def public_addresses(host):
        return ["93.184.216.34"]

    def run_gateway(self, response, hosts="media.example"):
        class FakeResponse:
            def __init__(self, status, headers, body):
                self.status, self.headers, self.body = status, headers, body

            def getheaders(self):
                return list(self.headers.items())

            def read(self, size=-1):
                if size is None or size < 0:
                    size = len(self.body)
                chunk, self.body = self.body[:size], self.body[size:]
                return chunk

            def close(self):
                pass

        class FakeConnection:
            requests = []

            def __init__(self, host, ip, port, **kwargs):
                self.host = host

            def request(self, method, target, headers):
                type(self).requests.append((self.host, method, target, headers))

            def getresponse(self):
                return FakeResponse(*response)

            def close(self):
                pass

        FakeConnection.requests = []
        with patch.dict(os.environ, {
            "DV_SOURCE_GATEWAY_ENABLED": "1",
            "DV_AUTHORIZED_SOURCE_HOSTS": hosts,
            "SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "1",
            "DV_SOURCE_GATEWAY_MAX_BYTES": "1048576",
            "DV_SOURCE_GATEWAY_TIMEOUT_SECONDS": "5",
            "DV_SOURCE_GATEWAY_TOTAL_TIMEOUT_SECONDS": "60",
        }):
            result = ingest_authorized_candidate(
                self.candidate_id, self.resource_id,
                public_https_url=self.public_url,
                resolve_public_addresses=self.public_addresses,
                pinned_connection_cls=FakeConnection,
            )
        return result, FakeConnection

    def test_downloads_confirmed_authorized_mp4_and_registers_exact_sha256(self):
        import hashlib
        payload = b"real-origin-media-bytes" * 100
        result, connection = self.run_gateway((200, {
            "Content-Type": "video/mp4",
            "Content-Length": str(len(payload)),
            "Content-Encoding": "identity",
        }, payload))
        digest = hashlib.sha256(payload).hexdigest()
        self.assertEqual(result["status"], "registered", msg=repr(result))
        self.assertEqual(result["sha256"], digest)
        self.assertEqual(result["byte_length"], len(payload))
        stored = self.object_root / "sha256" / digest[:2] / digest
        self.assertEqual(stored.read_bytes(), payload)
        self.assertEqual(connection.requests[0][1:3], ("GET", "/asset.mp4"))
        self.assertEqual(connection.requests[0][3]["Accept"], "video/mp4")
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_rejects_redirect_without_following_location(self):
        result, connection = self.run_gateway((302, {
            "Location": "https://other.example/asset.mp4",
        }, b""), hosts="media.example,other.example")
        self.assertEqual(result["status"], "failed")
        self.assertIn("redirect", result["reason"].lower())
        self.assertEqual(len(connection.requests), 1)
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_skips_source_host_not_in_exact_allowlist_before_connecting(self):
        result, connection = self.run_gateway((200, {
            "Content-Type": "video/mp4", "Content-Length": "4",
        }, b"data"), hosts="other.example")
        self.assertEqual(result, {
            "status": "skipped", "reason": "source_host_not_explicitly_authorized"
        })
        self.assertEqual(connection.requests, [])
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_rejects_mime_mismatch_and_truncated_body_without_registering(self):
        mismatch, _ = self.run_gateway((200, {
            "Content-Type": "text/html", "Content-Length": "4",
        }, b"oops"))
        self.assertEqual(mismatch["status"], "failed")
        self.assertIn("Content-Type", mismatch["reason"])
        truncated, _ = self.run_gateway((200, {
            "Content-Type": "video/mp4", "Content-Length": "12",
        }, b"short"))
        self.assertEqual(truncated["status"], "failed")
        self.assertIn("closed before", truncated["reason"])
        with registry_queue.connect() as db:
            count = db.execute(
                "SELECT COUNT(*) FROM registry_media_assets WHERE resource_id=?",
                (self.resource_id,),
            ).fetchone()[0]
        self.assertEqual(count, 0)
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_rejects_extra_bytes_and_non_identity_content_encoding(self):
        extra, _ = self.run_gateway((200, {
            "Content-Type": "video/mp4", "Content-Length": "4",
        }, b"extra"))
        self.assertEqual(extra["status"], "failed")
        self.assertIn("beyond", extra["reason"])
        compressed, _ = self.run_gateway((200, {
            "Content-Type": "video/mp4", "Content-Length": "5",
            "Content-Encoding": "gzip",
        }, b"12345"))
        self.assertEqual(compressed["status"], "failed")
        self.assertIn("Compressed", compressed["reason"])
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_gateway_fails_closed_when_disabled_or_firewall_not_confirmed(self):
        with patch.dict(os.environ, {
            "DV_SOURCE_GATEWAY_ENABLED": "0",
            "SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "1",
        }):
            disabled = ingest_authorized_candidate(
                self.candidate_id, self.resource_id,
                public_https_url=self.public_url,
                resolve_public_addresses=self.public_addresses,
                pinned_connection_cls=object,
            )
        self.assertEqual(disabled, {"status": "skipped", "reason": "source_gateway_disabled"})
        with patch.dict(os.environ, {
            "DV_SOURCE_GATEWAY_ENABLED": "1",
            "DV_AUTHORIZED_SOURCE_HOSTS": "media.example",
            "SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "0",
        }):
            blocked = ingest_authorized_candidate(
                self.candidate_id, self.resource_id,
                public_https_url=self.public_url,
                resolve_public_addresses=self.public_addresses,
                pinned_connection_cls=object,
            )
        self.assertEqual(blocked, {"status": "skipped", "reason": "egress_firewall_not_confirmed"})


    def test_playback_confirmation_enqueues_durable_ingestion_for_allowlisted_host(self):
        import hashlib
        with patch.dict(os.environ, {
            "DV_SOURCE_GATEWAY_ENABLED": "1",
            "DV_AUTHORIZED_SOURCE_HOSTS": "media.example",
            "SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "1",
        }), patch.object(collector, "require_token"), patch.object(
            collector.registry_store, "submit_job",
            return_value={"status": "queued", "id": "durable-job-1"},
        ) as submit:
            result = collector.record_playback_evidence(
                self.candidate_id,
                collector.PlaybackEvidence(
                    media_type="mp4", observed_seconds=6, progressed_seconds=4.5
                ),
                "Bearer test",
            )

        self.assertEqual(result["media_ingestion"], {
            "status": "queued", "job_id": "durable-job-1"
        })
        self.assertEqual(submit.call_count, 1)
        args, kwargs = submit.call_args
        self.assertEqual(args[0], "dv_media_ingest")
        payload = args[1]
        self.assertEqual(payload["candidate_id"], self.candidate_id)
        self.assertEqual(payload["resource_id"], result["resource"]["id"])
        with collector.db() as db:
            row = db.execute(
                "SELECT url,validation FROM candidates WHERE id=?",
                (self.candidate_id,),
            ).fetchone()
        expected_version = hashlib.sha256(
            (str(row["url"]) + "\0" + str(row["validation"] or "")).encode("utf-8")
        ).hexdigest()[:24]
        self.assertEqual(payload["source_version"], expected_version)
        self.assertEqual(args[2], "dv-source-ingest:" + self.candidate_id + ":" + expected_version)
        self.assertEqual(kwargs, {"max_attempts": 3})


if __name__ == "__main__":
    unittest.main()
