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
from dv_hls_source_gateway import ingest_authorized_hls_candidate


class AuthorizedHlsSourceGatewayTests(unittest.TestCase):
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
        task_id = "a" * 32
        self.candidate_id = "b" * 32
        now = 1_800_000_010
        validation = {
            "reachable": True,
            "media_format": "hls",
            "content_type": "application/vnd.apple.mpegurl",
            "final_url": "https://media.example/master.m3u8",
            "access": {"access_state": "PUBLIC"},
        }
        with collector.db() as connection:
            connection.execute(
                "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (task_id, "https://media.example/master.m3u8", "media.example", "completed", "http", now, now),
            )
            connection.execute(
                """INSERT INTO candidates
                   (id,task_id,url,host,kind,title,status,created_at,access_state,validation,playback_verification)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (self.candidate_id, task_id, "https://media.example/master.m3u8", "media.example",
                 "direct-media", "Authorized HLS test", "validated", now, "PUBLIC",
                 json.dumps(validation), json.dumps({
                     "state": "PLAYER_CONFIRMED", "media_type": "hls",
                     "progressed_seconds": 4.0,
                 })),
            )
        with patch.dict(os.environ, {
            "DV_SOURCE_GATEWAY_ENABLED": "0",
            "SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "1",
        }), patch.object(collector, "require_token"):
            self.registry_result = collector.record_playback_evidence(
                self.candidate_id,
                collector.PlaybackEvidence(
                    media_type="hls", observed_seconds=5, progressed_seconds=4.0
                ),
                "Bearer test",
            )
        self.resource_id = self.registry_result["resource"]["id"]

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

    def run_gateway(self, responses, hosts="media.example", connection_class=None):
        class FakeResponse:
            def __init__(self, status, headers, body):
                self.status = status
                self.headers = headers
                self.body = body

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
                self.target = None

            def request(self, method, target, headers):
                type(self).requests.append((self.host, method, target))

            def getresponse(self):
                host, _, target = type(self).requests[-1]
                status, headers, body = responses[(host, target)]
                return FakeResponse(status, headers, body)

            def close(self):
                pass

        selected_connection = connection_class or FakeConnection
        selected_connection.requests = []
        with patch.dict(os.environ, {
            "DV_SOURCE_GATEWAY_ENABLED": "1",
            "DV_AUTHORIZED_SOURCE_HOSTS": hosts,
            "SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "1",
            "DV_SOURCE_GATEWAY_MAX_BYTES": "1048576",
            "DV_SOURCE_GATEWAY_TIMEOUT_SECONDS": "5",
        }):
            return ingest_authorized_hls_candidate(
                self.candidate_id,
                self.resource_id,
                public_https_url=self.public_url,
                resolve_public_addresses=self.public_addresses,
                pinned_connection_cls=selected_connection,
            ), selected_connection

    def test_confirmed_hls_playback_queues_durable_graph_ingestion(self):
        with (
            patch.dict(os.environ, {
                "DV_SOURCE_GATEWAY_ENABLED": "1",
                "DV_AUTHORIZED_SOURCE_HOSTS": "media.example",
                "SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "1",
            }),
            patch.object(collector, "require_token"),
        ):
            result = collector.record_playback_evidence(
                self.candidate_id,
                collector.PlaybackEvidence(
                    media_type="hls", observed_seconds=5, progressed_seconds=4.0
                ),
                "Bearer test",
            )
        self.assertEqual(result["media_ingestion"]["status"], "queued")
        with registry_queue.connect() as db:
            row = db.execute(
                "SELECT job_type,payload FROM collector_jobs WHERE id=?",
                (result["media_ingestion"]["job_id"],),
            ).fetchone()
        self.assertEqual(row["job_type"], "dv_media_ingest")
        self.assertEqual(json.loads(row["payload"])["candidate_id"], self.candidate_id)
        self.assertEqual(json.loads(row["payload"])["resource_id"], self.resource_id)

    def test_worker_dispatches_hls_candidate_to_graph_source_gateway(self):
        import worker
        from dv_hls_source_gateway import ingest_authorized_hls_candidate

        with (
            patch.object(worker, "require_egress_firewall"),
            patch("dv_hls_source_gateway.ingest_authorized_hls_candidate", return_value={"status": "registered"}) as ingest,
        ):
            result = worker.handle(
                {"_job_type": "dv_media_ingest", "candidate_id": self.candidate_id, "resource_id": self.resource_id},
                lambda _event: None,
                lambda: False,
            )
        self.assertEqual(result["status"], "registered")
        ingest.assert_called_once()

    def test_downloads_authorized_hls_graph_and_registers_immutable_assets(self):
        manifest = b"#EXTM3U\n#EXTINF:4.0,\nsegment.ts\n#EXT-X-ENDLIST\n"
        segment = b"fake-transport-stream-segment"
        responses = {
            ("media.example", "/master.m3u8"): (200, {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Content-Length": str(len(manifest)),
                "Content-Encoding": "identity",
            }, manifest),
            ("media.example", "/segment.ts"): (200, {
                "Content-Type": "video/mp2t",
                "Content-Length": str(len(segment)),
                "Content-Encoding": "identity",
            }, segment),
        }
        result, connection = self.run_gateway(responses)
        self.assertEqual(result["status"], "registered", msg=repr(result))
        self.assertEqual(result["member_count"], 2)
        self.assertEqual(result["edge_count"], 1)
        self.assertEqual(len(connection.requests), 2)
        with registry_queue.connect() as db:
            assets = db.execute(
                "SELECT asset_id,sha256,byte_length,content_type,object_key FROM registry_media_assets WHERE resource_id=?",
                (self.resource_id,),
            ).fetchall()
            edges = db.execute(
                """SELECT e.relative_uri,e.role,c.content_type
                   FROM registry_hls_asset_edges e
                   JOIN registry_media_assets p ON p.asset_id=e.parent_asset_id
                   JOIN registry_media_assets c ON c.asset_id=e.child_asset_id
                   WHERE p.resource_id=?""",
                (self.resource_id,),
            ).fetchall()
        self.assertEqual(len(assets), 2)
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["role"], "segment")
        self.assertEqual(edges[0]["content_type"], "video/mp2t")
        for asset in assets:
            stored = self.object_root / asset["object_key"]
            self.assertTrue(stored.is_file())
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_downloads_nested_hls_variant_initialization_and_media_segment(self):
        master = b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nvariant/index.m3u8\n"
        variant = b'#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.0,\nsegment.m4s\n#EXT-X-ENDLIST\n'
        init = b"fake-mp4-initialization"
        segment = b"fake-fmp4-media-segment"
        responses = {
            ("media.example", "/master.m3u8"): (200, {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Content-Length": str(len(master)),
            }, master),
            ("media.example", "/variant/index.m3u8"): (200, {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Content-Length": str(len(variant)),
            }, variant),
            ("media.example", "/variant/init.mp4"): (200, {
                "Content-Type": "video/mp4",
                "Content-Length": str(len(init)),
            }, init),
            ("media.example", "/variant/segment.m4s"): (200, {
                "Content-Type": "video/iso.segment",
                "Content-Length": str(len(segment)),
            }, segment),
        }
        result, connection = self.run_gateway(responses)
        self.assertEqual(result["status"], "registered", msg=repr(result))
        self.assertEqual(result["member_count"], 4)
        self.assertEqual(result["edge_count"], 3)
        self.assertEqual(
            {target for _, _, target in connection.requests},
            {"/master.m3u8", "/variant/index.m3u8", "/variant/init.mp4", "/variant/segment.m4s"},
        )
        with registry_queue.connect() as db:
            roles = {
                row["role"] for row in db.execute(
                    """SELECT e.role FROM registry_hls_asset_edges e
                       JOIN registry_media_assets p ON p.asset_id=e.parent_asset_id
                       WHERE p.resource_id=?""",
                    (self.resource_id,),
                ).fetchall()
            }
        self.assertEqual(roles, {"playlist", "initialization", "segment"})
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_rejects_hls_origin_redirect_without_following_location(self):
        responses = {
            ("media.example", "/master.m3u8"): (302, {
                "Location": "https://other.example/master.m3u8",
            }, b""),
        }
        result, connection = self.run_gateway(responses, hosts="media.example,other.example")
        self.assertEqual(result["status"], "failed")
        self.assertIn("redirects", result["reason"])
        self.assertEqual(connection.requests, [("media.example", "GET", "/master.m3u8")])
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_rejects_non_allowlisted_hls_child_before_connecting_to_it(self):
        manifest = b"#EXTM3U\n#EXTINF:4.0,\nhttps://cdn.other.example/segment.ts\n"
        responses = {
            ("media.example", "/master.m3u8"): (200, {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Content-Length": str(len(manifest)),
            }, manifest),
        }
        result, connection = self.run_gateway(responses, hosts="media.example")
        self.assertEqual(result["status"], "failed")
        self.assertIn("allowlist", result["reason"])
        self.assertEqual(connection.requests, [("media.example", "GET", "/master.m3u8")])
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_rejects_staged_hls_member_that_does_not_match_transfer_digest(self):
        import hashlib
        import dv_hls_source_gateway as gateway

        manifest = b"#EXTM3U\n#EXTINF:4.0,\nsegment.ts\n#EXT-X-ENDLIST\n"
        segment = b"authorized-segment-bytes"
        def fake_fetch(url, destination, **kwargs):
            payload = manifest if url.endswith("master.m3u8") else segment
            destination.write_bytes(payload)
            kwargs["progress"]["total_bytes"] += len(payload)
            digest = hashlib.sha256(payload).hexdigest()
            if url.endswith("segment.ts"):
                digest = "0" * 64
            return digest, len(payload)

        with (
            patch.dict(os.environ, {
                "DV_SOURCE_GATEWAY_ENABLED": "1",
                "DV_AUTHORIZED_SOURCE_HOSTS": "media.example",
                "SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "1",
            }),
            patch.object(gateway, "_fetch_member", side_effect=fake_fetch),
            patch.object(gateway, "ingest_hls_directory") as ingest_graph,
        ):
            result = gateway.ingest_authorized_hls_candidate(
                self.candidate_id,
                self.resource_id,
                public_https_url=self.public_url,
                resolve_public_addresses=self.public_addresses,
                pinned_connection_cls=object,
            )
        self.assertEqual(result["status"], "failed")
        self.assertIn("transfer digest", result["reason"])
        ingest_graph.assert_not_called()
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_rejects_live_hls_playlist_before_fetching_segments(self):
        manifest = b"#EXTM3U\n#EXTINF:4.0,\nsegment.ts\n"
        responses = {
            ("media.example", "/master.m3u8"): (200, {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Content-Length": str(len(manifest)),
            }, manifest),
        }
        result, connection = self.run_gateway(responses)
        self.assertEqual(result["status"], "failed")
        self.assertIn("finalized HLS", result["reason"])
        self.assertEqual(connection.requests, [("media.example", "GET", "/master.m3u8")])
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_rejects_hls_path_traversal_before_fetching_child(self):
        manifest = b"#EXTM3U\\n#EXTINF:4.0,\\n%252e%252e/private.ts\\n#EXT-X-ENDLIST\\n"
        responses = {
            ("media.example", "/master.m3u8"): (200, {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Content-Length": str(len(manifest)),
            }, manifest),
        }
        result, connection = self.run_gateway(responses)
        self.assertEqual(result["status"], "failed")
        self.assertIn("path traversal", result["reason"])
        self.assertEqual(connection.requests, [("media.example", "GET", "/master.m3u8")])
        self.assertFalse(any(self.staging_root.iterdir()))

    def test_rejects_encrypted_hls_before_fetching_key_or_segment(self):
        manifest = b'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="secret.key"\n#EXTINF:4.0,\nsegment.ts\n'
        responses = {
            ("media.example", "/master.m3u8"): (200, {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Content-Length": str(len(manifest)),
            }, manifest),
        }
        result, connection = self.run_gateway(responses)
        self.assertEqual(result["status"], "failed")
        self.assertIn("Encrypted or DRM", result["reason"])
        self.assertEqual(connection.requests, [("media.example", "GET", "/master.m3u8")])
        self.assertFalse(any(self.staging_root.iterdir()))


if __name__ == "__main__":
    unittest.main()
