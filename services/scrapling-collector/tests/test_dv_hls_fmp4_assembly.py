import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import registry_queue as queue
from dv_hls_ingest import ingest_hls_directory
from dv_hls_fmp4_assembly import HlsAssemblyError, assemble_registered_hls_fmp4


def box(kind: str, payload: bytes) -> bytes:
    return (8 + len(payload)).to_bytes(4, "big") + kind.encode("ascii") + payload


def init_segment() -> bytes:
    return box("ftyp", b"isom0000") + box("moov", b"")


def media_fragment(sequence: int) -> bytes:
    mfhd = box("mfhd", b"\x00\x00\x00\x00" + sequence.to_bytes(4, "big"))
    return box("moof", mfhd) + box("mdat", b"sample-data")


class HlsFmp4AssemblyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / "collector.sqlite3"
        self.db_patch = patch.object(queue, "DB_PATH", self.db)
        self.db_patch.start()
        queue.initialize()
        self.object_root = self.root / "objects"
        self.stage = self.root / "staging"
        self.stage.mkdir()
        self.resource = queue.upsert_resource({
            "resource_key": "resource:hls-fmp4-assembly",
            "source_key": "provider",
            "resource_type": "DIRECT_MEDIA",
            "url": "https://media.example.org/master.m3u8",
            "title": "Clear fMP4 HLS fixture",
            "access_state": "PUBLIC",
            "media_format": "hls",
        })
        queue.record_verification(self.resource["id"], "preflight", "passed", {"access_state": "PUBLIC"})
        queue.record_verification(self.resource["id"], "player", "passed", {"progressed_seconds": 3})

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def prepare_graph(self, second_sequence=2, segment_extension=".m4s", extra_playlist_lines=""):
        (self.stage / "master.m3u8").write_text(
            '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,CODECS="dvhe.05.06"\nvariant.m3u8\n',
            encoding="utf-8",
        )
        (self.stage / "variant.m3u8").write_text(
            "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MAP:URI=\"init.mp4\"\n"
            "#EXTINF:4.0,\nseg1" + segment_extension + "\n" + extra_playlist_lines +
            "#EXTINF:4.0,\nseg2" + segment_extension + "\n#EXT-X-ENDLIST\n",
            encoding="utf-8",
        )
        (self.stage / "init.mp4").write_bytes(init_segment())
        if segment_extension == ".m4s":
            (self.stage / "seg1.m4s").write_bytes(media_fragment(1))
            (self.stage / "seg2.m4s").write_bytes(media_fragment(second_sequence))
        else:
            (self.stage / "seg1.ts").write_bytes(b"not-an-fmp4-fragment")
            (self.stage / "seg2.ts").write_bytes(b"not-an-fmp4-fragment")
        ingested = ingest_hls_directory(
            self.resource["id"], self.stage, "master.m3u8", self.object_root,
        )
        variant_id = ingested["assets"]["variant.m3u8"]["asset_id"]
        return variant_id, ingested

    def test_assembles_hash_verified_init_and_ordered_fmp4_fragments(self):
        variant_id, ingested = self.prepare_graph()
        output = self.root / "assembled.mp4"
        result = assemble_registered_hls_fmp4(
            self.resource["id"], variant_id, output, self.object_root,
        )
        expected = init_segment() + media_fragment(1) + media_fragment(2)
        self.assertEqual(output.read_bytes(), expected)
        self.assertEqual(result["assembledByteLength"], len(expected))
        self.assertEqual(result["assembledSha256"], hashlib.sha256(expected).hexdigest())
        self.assertEqual(result["fragmentSequenceNumbers"], [1, 2])
        self.assertEqual(result["segmentAssetIds"], [
            ingested["assets"]["seg1.m4s"]["asset_id"],
            ingested["assets"]["seg2.m4s"]["asset_id"],
        ])
        self.assertEqual(result["rpuPresence"], "unknown")

    def test_rejects_non_contiguous_fragment_sequence_numbers(self):
        variant_id, _ = self.prepare_graph(second_sequence=4)
        with self.assertRaisesRegex(HlsAssemblyError, "not contiguous"):
            assemble_registered_hls_fmp4(
                self.resource["id"], variant_id, self.root / "bad.mp4", self.object_root,
            )

    def test_rejects_discontinuities_instead_of_claiming_continuity(self):
        variant_id, _ = self.prepare_graph(extra_playlist_lines="#EXT-X-DISCONTINUITY\n")
        with self.assertRaisesRegex(HlsAssemblyError, "Discontinuities"):
            assemble_registered_hls_fmp4(
                self.resource["id"], variant_id, self.root / "bad.mp4", self.object_root,
            )

    def test_rejects_mpeg_ts_media_segments(self):
        variant_id, _ = self.prepare_graph(segment_extension=".ts")
        with self.assertRaisesRegex(HlsAssemblyError, "Only registered fMP4"):
            assemble_registered_hls_fmp4(
                self.resource["id"], variant_id, self.root / "bad.mp4", self.object_root,
            )

    def test_rejects_modified_content_addressed_segment(self):
        variant_id, ingested = self.prepare_graph()
        segment = ingested["assets"]["seg1.m4s"]
        object_path = self.object_root / segment["object_key"]
        object_path.write_bytes(media_fragment(1)[:-1] + b"x")
        with self.assertRaises(HlsAssemblyError):
            assemble_registered_hls_fmp4(
                self.resource["id"], variant_id, self.root / "bad.mp4", self.object_root,
            )

    def test_rejects_playlist_not_bound_to_selected_resource(self):
        variant_id, _ = self.prepare_graph()
        other = queue.upsert_resource({
            "resource_key": "resource:hls-fmp4-other",
            "source_key": "provider",
            "resource_type": "DIRECT_MEDIA",
            "url": "https://other.example.org/master.m3u8",
            "title": "Other resource",
            "access_state": "PUBLIC",
            "media_format": "hls",
        })
        with self.assertRaises(HlsAssemblyError):
            assemble_registered_hls_fmp4(
                other["id"], variant_id, self.root / "bad.mp4", self.object_root,
            )


if __name__ == "__main__":
    unittest.main()
