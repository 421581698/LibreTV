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
        })

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
