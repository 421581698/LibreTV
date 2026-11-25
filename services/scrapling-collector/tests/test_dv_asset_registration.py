import asyncio
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SCRAPLING_API_TOKEN", "collector-registration-test-token")
os.environ.setdefault(
    "SCRAPLING_DB_PATH",
    str(Path(tempfile.gettempdir()) / "libretv-dv-registration-tests.sqlite3"),
)

import registry_queue as registry


class MediaAssetRegistrationEligibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(registry, "DB_PATH", Path(self.temp.name) / "registry.sqlite3")
        self.db_patch.start()
        self.object_root = Path(self.temp.name) / "objects"
        self.object_root_patch = patch.object(registry, "DV_MEDIA_OBJECT_ROOT", self.object_root)
        self.object_root_patch.start()
        registry.initialize()

    def tearDown(self):
        self.object_root_patch.stop()
        self.db_patch.stop()
        self.temp.cleanup()

    def make_resource(self, key, media_format="mp4", *, confirmed=True):
        resource = registry.upsert_resource({
            "resource_key": key,
            "source_key": "registration-eligibility-test",
            "resource_type": "DIRECT_MEDIA",
            "url": "https://media.example.test/asset",
            "title": "Registration eligibility fixture",
            "access_state": "PUBLIC",
            "media_format": media_format,
        })
        if confirmed:
            registry.record_verification(
                resource["id"], "preflight", "passed", {"access_state": "PUBLIC"}
            )
            registry.record_verification(
                resource["id"], "player", "passed", {"progressed_seconds": 4}
            )
        return resource

    def register(self, resource, content_type="video/mp4", digest="a" * 64, byte_length=128):
        return registry.register_dolby_vision_media_asset(
            resource["id"], digest, byte_length, content_type
        )

    def test_rejects_registration_for_unverified_resource(self):
        resource = self.make_resource("dv-registration:unverified", confirmed=False)
        with self.assertRaisesRegex(ValueError, "validated PUBLIC player-confirmed"):
            self.register(resource)
        with registry.connect() as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM registry_media_assets WHERE resource_id=?",
                (resource["id"],),
            ).fetchone()[0]
        self.assertEqual(count, 0)

    def test_rejects_registration_when_resource_is_no_longer_public(self):
        resource = self.make_resource("dv-registration:blocked")
        with registry.connect() as connection:
            connection.execute(
                "UPDATE registry_resources SET access_state='AUTH_REQUIRED' WHERE id=?",
                (resource["id"],),
            )
        with self.assertRaisesRegex(ValueError, "validated PUBLIC player-confirmed"):
            self.register(resource)

    def test_rejects_registration_when_resource_format_and_asset_type_disagree(self):
        resource = self.make_resource("dv-registration:mismatch", media_format="mp4")
        with self.assertRaisesRegex(ValueError, "matching media format"):
            self.register(resource, content_type="video/webm")

    def test_rejects_embedded_player_resources_even_when_public_and_played(self):
        resource = registry.upsert_resource({
            "resource_key": "dv-registration:embedded",
            "source_key": "registration-eligibility-test",
            "resource_type": "EMBEDDED_PLAYER",
            "url": "https://media.example.test/embed",
            "title": "Embedded player fixture",
            "access_state": "PUBLIC",
            "media_format": "mp4",
        })
        registry.record_verification(
            resource["id"], "preflight", "passed", {"access_state": "PUBLIC"}
        )
        registry.record_verification(
            resource["id"], "player", "passed", {"progressed_seconds": 4}
        )
        with self.assertRaisesRegex(ValueError, "DIRECT_MEDIA"):
            self.register(resource)


    def test_media_content_endpoint_verifies_full_object_digest_before_streaming(self):
        payload = b"immutable-media-payload"
        digest = hashlib.sha256(payload).hexdigest()
        resource = self.make_resource("dv-registration:stream-valid")
        asset = self.register(resource, digest=digest, byte_length=len(payload))
        object_path = self.object_root / asset["object_key"]
        object_path.parent.mkdir(parents=True, exist_ok=True)
        object_path.write_bytes(payload)

        response = registry.api_get_dolby_vision_media_asset_content(
            asset["asset_id"], f"Bearer {registry.TOKEN}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["ETag"], f'"{digest}"')

        async def collect_body():
            return b"".join([chunk async for chunk in response.body_iterator])

        self.assertEqual(asyncio.run(collect_body()), payload)

    def test_media_content_endpoint_rejects_same_length_digest_mismatch_for_full_and_range_reads(self):
        expected = b"original-media-bytes"
        tampered = b"replaced-media-bytes"
        self.assertEqual(len(expected), len(tampered))
        resource = self.make_resource("dv-registration:stream-tampered")
        asset = self.register(resource, digest=hashlib.sha256(expected).hexdigest(), byte_length=len(expected))
        object_path = self.object_root / asset["object_key"]
        object_path.parent.mkdir(parents=True, exist_ok=True)
        object_path.write_bytes(tampered)

        for range_header in (None, "bytes=0-3"):
            with self.subTest(range_header=range_header):
                with self.assertRaises(registry.HTTPException) as error:
                    registry.api_get_dolby_vision_media_asset_content(
                        asset["asset_id"],
                        f"Bearer {registry.TOKEN}",
                        range_header,
                    )
                self.assertEqual(error.exception.status_code, 409)
                self.assertIn("digest", error.exception.detail)

    def test_accepts_confirmed_mp4_and_webm_assets(self):
        mp4 = self.make_resource("dv-registration:mp4", media_format="mp4")
        webm = self.make_resource("dv-registration:webm", media_format="webm")
        self.assertEqual(self.register(mp4, "video/mp4", "b" * 64)["content_type"], "video/mp4")
        self.assertEqual(self.register(webm, "video/webm", "c" * 64)["content_type"], "video/webm")

    def test_accepts_hls_graph_members_only_for_confirmed_hls_resource(self):
        resource = self.make_resource("dv-registration:hls", media_format="hls")
        asset = self.register(
            resource,
            content_type="application/vnd.apple.mpegurl",
            digest="d" * 64,
        )
        self.assertEqual(asset["content_type"], "application/vnd.apple.mpegurl")
        with self.assertRaisesRegex(ValueError, "matching media format"):
            self.register(
                resource,
                content_type="video/webm",
                digest="e" * 64,
            )


if __name__ == "__main__":
    unittest.main()
