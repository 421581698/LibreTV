import asyncio
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import registry_queue as registry
from dv_media_ingest import IngestionError, ingest_staged_file


class DolbyVisionMediaIngestionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db_path = self.root / "registry.sqlite3"
        self.db_patch = patch.object(registry, "DB_PATH", self.db_path)
        self.db_patch.start()
        registry.initialize()
        self.object_root = self.root / "objects"

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def add_resource(self, resource_key):
        return registry.upsert_resource({
            "resource_key": resource_key,
            "source_key": "trusted-ingest-test",
            "resource_type": "DIRECT_MEDIA",
            "url": "https://media.example.test/asset.mp4",
            "title": "Ingestion fixture",
            "access_state": "PUBLIC",
            "media_format": "mp4",
        }) | {}
        registry.record_verification(resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        registry.record_verification(resource["id"], "player", "passed", {"progressed_seconds": 5})
        return resource

    def test_ingests_exact_bytes_and_registers_computed_digest(self):
        resource = self.add_resource("dv-ingest:one")
        payload = (b"media-bytes-" * 120_000) + b"end"
        staged = self.root / "staged.mp4"
        staged.write_bytes(payload)

        result = ingest_staged_file(
            resource["id"], staged, self.object_root, "video/mp4"
        )

        expected = hashlib.sha256(payload).hexdigest()
        self.assertEqual(result["sha256"], expected)
        self.assertEqual(result["byte_length"], len(payload))
        stored = self.object_root / "sha256" / expected[:2] / expected
        self.assertEqual(stored.read_bytes(), payload)
        self.assertEqual(result["asset"]["sha256"], expected)
        self.assertEqual(result["asset"]["object_key"], f"sha256/{expected[:2]}/{expected}")

    def test_ingests_webm_assets_for_native_registry_playback(self):
        resource = self.add_resource("dv-ingest:webm")
        payload = b"webm-media-bytes"
        staged = self.root / "staged.webm"
        staged.write_bytes(payload)

        result = ingest_staged_file(
            resource["id"], staged, self.object_root, "video/webm"
        )

        self.assertEqual(result["asset"]["content_type"], "video/webm")
        self.assertEqual(result["byte_length"], len(payload))
        self.assertEqual(result["sha256"], hashlib.sha256(payload).hexdigest())

    def test_same_content_is_shared_without_overwriting_existing_object(self):
        first = self.add_resource("dv-ingest:first")
        second = self.add_resource("dv-ingest:second")
        payload = b"same exact media bytes"
        staged = self.root / "same.bin"
        staged.write_bytes(payload)

        one = ingest_staged_file(first["id"], staged, self.object_root, "video/mp4")
        two = ingest_staged_file(second["id"], staged, self.object_root, "video/mp4")

        self.assertEqual(one["asset"]["object_key"], two["asset"]["object_key"])
        self.assertNotEqual(one["asset"]["asset_id"], two["asset"]["asset_id"])

    def test_rejects_ingestion_when_resource_is_not_validated_and_player_confirmed(self):
        resource = registry.upsert_resource({
            "resource_key": "dv-ingest:unverified",
            "source_key": "trusted-ingest-test",
            "resource_type": "DIRECT_MEDIA",
            "url": "https://media.example.test/unverified.mp4",
            "title": "Unverified fixture",
            "access_state": "PUBLIC",
            "media_format": "mp4",
        })
        staged = self.root / "unverified.mp4"
        staged.write_bytes(b"media")
        with self.assertRaises(IngestionError):
            ingest_staged_file(resource["id"], staged, self.object_root, "video/mp4")
        self.assertFalse(self.object_root.exists())

    def test_rejects_content_type_that_disagrees_with_validated_resource_format(self):
        resource = self.add_resource("dv-ingest:mime-mismatch")
        staged = self.root / "mismatch.webm"
        staged.write_bytes(b"webm bytes")
        with self.assertRaises(IngestionError):
            ingest_staged_file(resource["id"], staged, self.object_root, "video/webm")
        self.assertFalse(self.object_root.exists())

    def test_rejects_symlink_source_and_unknown_resource(self):
        resource = self.add_resource("dv-ingest:symlink")
        real = self.root / "real.mp4"
        real.write_bytes(b"not a symlink target")
        link = self.root / "link.mp4"
        link.symlink_to(real)
        with self.assertRaises(IngestionError):
            ingest_staged_file(resource["id"], link, self.object_root, "video/mp4")
        with self.assertRaises(IngestionError):
            ingest_staged_file("missing-resource", real, self.object_root, "video/mp4")

    def test_rejects_oversized_empty_and_unsupported_files(self):
        resource = self.add_resource("dv-ingest:limits")
        staged = self.root / "oversized.mp4"
        staged.write_bytes(b"123456")
        with self.assertRaises(IngestionError):
            ingest_staged_file(resource["id"], staged, self.object_root, "video/mp4", max_bytes=5)
        staged.write_bytes(b"")
        with self.assertRaises(IngestionError):
            ingest_staged_file(resource["id"], staged, self.object_root, "video/mp4")
        staged.write_bytes(b"media")
        with self.assertRaises(IngestionError):
            ingest_staged_file(resource["id"], staged, self.object_root, "text/html")

    def make_stream_request(self, payload, content_type="video/mp4", declared_length=None):
        from starlette.requests import Request
        length = len(payload) if declared_length is None else declared_length
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/v1/registry/resources/test/media-assets/ingest",
            "raw_path": b"/v1/registry/resources/test/media-assets/ingest",
            "query_string": b"",
            "headers": [
                (b"content-type", content_type.encode()),
                (b"content-length", str(length).encode()),
            ],
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 12345),
        }
        consumed = False
        async def receive():
            nonlocal consumed
            if consumed:
                return {"type": "http.disconnect"}
            consumed = True
            return {"type": "http.request", "body": payload, "more_body": False}
        return Request(scope, receive)

    def test_authenticated_stream_ingest_hashes_and_registers_received_bytes(self):
        resource = self.add_resource("dv-ingest:http")
        payload = b"trusted byte-ingress payload"
        request = self.make_stream_request(payload)
        with (
            patch.object(registry, "DV_INGESTION_TOKEN", "dedicated-secret"),
            patch.object(registry, "DV_MEDIA_STAGING_ROOT", self.root / "staging"),
            patch.object(registry, "DV_MEDIA_OBJECT_ROOT", self.object_root),
        ):
            result = asyncio.run(registry.api_ingest_dolby_vision_media_asset(
                resource["id"], request, x_dv_ingestion_token="dedicated-secret"
            ))
        expected = hashlib.sha256(payload).hexdigest()
        self.assertEqual(result["sha256"], expected)
        self.assertEqual(result["byte_length"], len(payload))
        self.assertEqual(result["asset"]["sha256"], expected)
        self.assertFalse(any((self.root / "staging").iterdir()))

    def test_stream_ingest_rejects_uploads_over_configured_limit_before_staging(self):
        resource = self.add_resource("dv-ingest:http-limit")
        request = self.make_stream_request(b"123456")
        with (
            patch.object(registry, "DV_INGESTION_TOKEN", "dedicated-secret"),
            patch.object(registry, "DV_MAX_INGEST_BYTES", 5),
            patch.object(registry, "DV_MEDIA_STAGING_ROOT", self.root / "staging"),
        ):
            with self.assertRaises(Exception) as raised:
                asyncio.run(registry.api_ingest_dolby_vision_media_asset(
                    resource["id"], request, x_dv_ingestion_token="dedicated-secret"
                ))
        self.assertEqual(getattr(raised.exception, "status_code", None), 413)
        self.assertFalse((self.root / "staging").exists())

    def test_stream_ingest_returns_retryable_busy_when_capacity_is_full(self):
        from unittest.mock import Mock
        resource = self.add_resource("dv-ingest:http-busy")
        semaphore = Mock()
        semaphore.acquire.return_value = False
        with (
            patch.object(registry, "DV_INGESTION_TOKEN", "dedicated-secret"),
            patch.object(registry, "DV_INGESTION_SLOTS", semaphore),
        ):
            with self.assertRaises(Exception) as raised:
                asyncio.run(registry.api_ingest_dolby_vision_media_asset(
                    resource["id"], self.make_stream_request(b"payload"),
                    x_dv_ingestion_token="dedicated-secret"
                ))
        self.assertEqual(getattr(raised.exception, "status_code", None), 429)
        self.assertEqual(raised.exception.headers.get("Retry-After"), "5")
        semaphore.release.assert_not_called()

    def test_stream_ingest_requires_dedicated_token_and_exact_content_length(self):
        resource = self.add_resource("dv-ingest:http-reject")
        with patch.object(registry, "DV_INGESTION_TOKEN", "dedicated-secret"):
            with self.assertRaises(Exception) as unauthorized:
                asyncio.run(registry.api_ingest_dolby_vision_media_asset(
                    resource["id"], self.make_stream_request(b"payload"),
                    x_dv_ingestion_token="wrong-token"
                ))
            self.assertEqual(getattr(unauthorized.exception, "status_code", None), 401)
            with (
                patch.object(registry, "DV_MEDIA_STAGING_ROOT", self.root / "staging"),
                patch.object(registry, "DV_MEDIA_OBJECT_ROOT", self.object_root),
            ):
                with self.assertRaises(Exception) as mismatch:
                    asyncio.run(registry.api_ingest_dolby_vision_media_asset(
                        resource["id"], self.make_stream_request(b"short", declared_length=20),
                        x_dv_ingestion_token="dedicated-secret"
                    ))
                self.assertEqual(getattr(mismatch.exception, "status_code", None), 400)
        self.assertFalse((self.root / "staging").exists() and any((self.root / "staging").iterdir()))

    def test_registered_object_content_endpoint_streams_only_registry_bound_bytes(self):
        resource = self.add_resource("dv-ingest:stream")
        payload = b"stream only the exact content-addressed object"
        staged = self.root / "stream.mp4"
        staged.write_bytes(payload)
        with patch.object(registry, "DV_MEDIA_OBJECT_ROOT", self.object_root):
            result = ingest_staged_file(resource["id"], staged, self.object_root, "video/mp4")
            with patch.object(registry, "require_auth"):
                response = registry.api_get_dolby_vision_media_asset_content(
                    result["asset"]["asset_id"], authorization="Bearer collector"
                )
            async def read_body():
                return b"".join([chunk async for chunk in response.body_iterator])
            body = asyncio.run(read_body())
        self.assertEqual(body, payload)
        self.assertEqual(response.headers["x-dv-asset-sha256"], result["sha256"])
        self.assertEqual(response.headers["content-length"], str(len(payload)))
        self.assertEqual(response.headers["etag"], f'"{result["sha256"]}"')

    def test_registered_object_content_endpoint_rejects_tampered_registry_key(self):
        resource = self.add_resource("dv-ingest:tampered-key")
        staged = self.root / "tampered.mp4"
        staged.write_bytes(b"bound media")
        result = ingest_staged_file(resource["id"], staged, self.object_root, "video/mp4")
        with registry.connect() as connection:
            connection.execute(
                "UPDATE registry_media_assets SET object_key=? WHERE asset_id=?",
                ("../../etc/passwd", result["asset"]["asset_id"]),
            )
        from fastapi import HTTPException
        with patch.object(registry, "require_auth"), patch.object(registry, "DV_MEDIA_OBJECT_ROOT", self.object_root):
            with self.assertRaises(HTTPException) as raised:
                registry.api_get_dolby_vision_media_asset_content(
                    result["asset"]["asset_id"], authorization="Bearer collector"
                )
        self.assertEqual(raised.exception.status_code, 409)

    def test_detects_corrupted_existing_content_addressed_object(self):
        resource = self.add_resource("dv-ingest:corrupt")
        staged = self.root / "source.mp4"
        staged.write_bytes(b"original bytes")
        result = ingest_staged_file(resource["id"], staged, self.object_root, "video/mp4")
        stored = Path(result["stored_path"])
        stored.chmod(0o600)
        stored.write_bytes(b"corrupted bytes")
        other = self.add_resource("dv-ingest:corrupt-other")
        with self.assertRaises(IngestionError):
            ingest_staged_file(other["id"], staged, self.object_root, "video/mp4")


if __name__ == "__main__":
    unittest.main()
