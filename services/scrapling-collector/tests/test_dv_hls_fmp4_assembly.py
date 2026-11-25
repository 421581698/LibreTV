import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import registry_queue as queue
from dv_hls_ingest import ingest_hls_directory
import dv_hls_fmp4_assembly as hls_assembly
from dv_hls_fmp4_assembly import HlsAssemblyError, assemble_registered_hls_fmp4


def box(kind: str, payload: bytes) -> bytes:
    return (8 + len(payload)).to_bytes(4, "big") + kind.encode("ascii") + payload


def init_segment() -> bytes:
    tkhd = box("tkhd", b"\x00\x00\x00\x00" + b"\x00" * 8 + (1).to_bytes(4, "big") + b"\x00" * 8)
    mdhd = box("mdhd", b"\x00\x00\x00\x00" + b"\x00" * 8 + (1000).to_bytes(4, "big") + b"\x00" * 4)
    hdlr = box("hdlr", b"\x00" * 4 + b"\x00" * 4 + b"vide")
    trak = box("trak", tkhd + box("mdia", mdhd + hdlr))
    trex = box("trex", b"\x00" * 4 + (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + (0).to_bytes(4, "big") + b"\x00" * 8)
    return box("ftyp", b"isom0000") + box("moov", trak + box("mvex", trex))


def media_fragment(sequence: int, decode_time: int | None = None, sample_duration: int = 4000) -> bytes:
    decode_time = (sequence - 1) * 4000 if decode_time is None else decode_time
    mfhd = box("mfhd", b"\x00\x00\x00\x00" + sequence.to_bytes(4, "big"))
    tfhd = box("tfhd", b"\x00\x00\x00\x08" + (1).to_bytes(4, "big") + sample_duration.to_bytes(4, "big"))
    tfdt = box("tfdt", b"\x00\x00\x00\x00" + decode_time.to_bytes(4, "big"))
    trun = box("trun", b"\x00\x00\x01\x00" + (1).to_bytes(4, "big") + sample_duration.to_bytes(4, "big"))
    return box("moof", mfhd + box("traf", tfhd + tfdt + trun)) + box("mdat", b"sample-data")

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

    def prepare_graph(self, second_sequence=2, segment_extension=".m4s", extra_playlist_lines="", second_decode_time=None):
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
            (self.stage / "seg2.m4s").write_bytes(media_fragment(second_sequence, decode_time=second_decode_time))
        else:
            (self.stage / "seg1.ts").write_bytes(b"not-an-fmp4-fragment-one")
            (self.stage / "seg2.ts").write_bytes(b"not-an-fmp4-fragment-two")
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
        self.assertEqual(
            result["graphDigest"],
            hashlib.sha256(json.dumps(
                result["graphManifest"], sort_keys=True, separators=(",", ":"), ensure_ascii=True,
            ).encode("utf-8")).hexdigest(),
        )
        self.assertEqual(result["graphManifest"]["resourceId"], self.resource["id"])
        self.assertEqual(result["graphManifest"]["graphId"], result["graphId"])
        self.assertEqual(
            [member["role"] for member in result["graphManifest"]["members"]],
            ["initialization", "segment", "segment"],
        )
        self.assertEqual(result["fragmentSequenceNumbers"], [1, 2])
        self.assertEqual(result["fragmentSequenceContinuity"], "sequential")
        self.assertEqual(result["temporalContinuity"], "contiguous")
        self.assertEqual([entry["decodeTime"] for entry in result["videoTimeline"]], [0, 4000])
        self.assertEqual([entry["sampleCount"] for entry in result["videoTimeline"]], [1, 1])
        self.assertEqual([entry["sampleDuration"] for entry in result["videoTimeline"]], [4000, 4000])
        self.assertEqual(result["segmentAssetIds"], [
            ingested["assets"]["seg1.m4s"]["asset_id"],
            ingested["assets"]["seg2.m4s"]["asset_id"],
        ])
        self.assertEqual(result["rpuPresence"], "unknown")
        self.assertEqual(len(result["segmentInputs"]), 2)
        for ordinal, item in enumerate(result["segmentInputs"]):
            expected_fragment = media_fragment(ordinal + 1)
            expected_input = init_segment() + expected_fragment
            segment_path = Path(item["outputPath"])
            self.assertEqual(segment_path.read_bytes(), expected_input)
            self.assertEqual(item["ordinal"], ordinal)
            self.assertEqual(item["fragmentAssetId"], result["segmentAssetIds"][ordinal])
            self.assertEqual(item["fragmentSha256"], hashlib.sha256(expected_fragment).hexdigest())
            self.assertEqual(item["initializationSha256"], hashlib.sha256(init_segment()).hexdigest())
            self.assertEqual(item["assembledSegmentSha256"], hashlib.sha256(expected_input).hexdigest())
            self.assertEqual(item["decodeTime"], ordinal * 4000)
            self.assertEqual(item["sampleDuration"], 4000)
            self.assertEqual(item["sampleCount"], 1)


    def test_fragment_only_assembly_writes_only_requested_init_and_fragment(self):
        variant_id, _ = self.prepare_graph()
        output = self.root / "single-fragment.mp4"
        result = assemble_registered_hls_fmp4(
            self.resource["id"], variant_id, output, self.object_root, fragment_ordinal=1,
        )
        expected = init_segment() + media_fragment(2)
        self.assertEqual(output.read_bytes(), expected)
        self.assertFalse(output.with_name(output.name + ".segments").exists())
        self.assertEqual(len(result["segmentInputs"]), 1)
        self.assertEqual(result["segmentInputs"][0]["ordinal"], 1)
        self.assertEqual(result["segmentInputs"][0]["fragmentSequenceNumber"], 2)
        self.assertEqual(result["segmentInputs"][0]["assembledSegmentSha256"], hashlib.sha256(expected).hexdigest())
        self.assertEqual(result["assembledSha256"], hashlib.sha256(expected).hexdigest())
        self.assertEqual(result["assembledByteLength"], len(expected))


    def test_fragment_requests_reuse_validated_graph_timeline_cache(self):
        variant_id, _ = self.prepare_graph()
        with patch.object(
            hls_assembly,
            "_fragment_video_timing",
            wraps=hls_assembly._fragment_video_timing,
        ) as timing:
            first = assemble_registered_hls_fmp4(
                self.resource["id"], variant_id, self.root / "cached-0.mp4",
                self.object_root, fragment_ordinal=0,
            )
            self.assertEqual(timing.call_count, 2)
            second = assemble_registered_hls_fmp4(
                self.resource["id"], variant_id, self.root / "cached-1.mp4",
                self.object_root, fragment_ordinal=1,
            )
            self.assertEqual(timing.call_count, 2)
        self.assertEqual(first["segmentInputs"][0]["ordinal"], 0)
        self.assertEqual(second["segmentInputs"][0]["ordinal"], 1)
        self.assertEqual(second["segmentInputs"][0]["decodeTime"], 4000)

    def test_rejects_non_contiguous_tfdt_timestamps_even_when_mfhd_is_sequential(self):
        variant_id, _ = self.prepare_graph(second_decode_time=4500)
        with self.assertRaisesRegex(HlsAssemblyError, "tfdt timestamps"):
            assemble_registered_hls_fmp4(
                self.resource["id"], variant_id, self.root / "bad-timeline.mp4", self.object_root,
            )

    def test_rejects_non_contiguous_fragment_sequence_numbers(self):
        variant_id, _ = self.prepare_graph(second_sequence=4, second_decode_time=4000)
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

    def test_rejects_modified_root_playlist_before_graph_provenance_binding(self):
        variant_id, ingested = self.prepare_graph()
        root = ingested["assets"]["master.m3u8"]
        (self.object_root / root["object_key"]).write_bytes(b"#EXTM3U\\n# tampered\\n")
        with self.assertRaises(HlsAssemblyError):
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

    def test_authenticated_api_streams_assembled_mp4_with_explicit_unknown_rpu_state(self):
        variant_id, _ = self.prepare_graph()
        staging_root = self.root / "api-staging"
        with patch.object(queue, "DV_MEDIA_OBJECT_ROOT", self.object_root), \
                patch.object(queue, "DV_MEDIA_STAGING_ROOT", staging_root), \
                patch.object(queue, "require_auth") as require_auth:
            response = queue.api_assemble_hls_fmp4(
                self.resource["id"], variant_id, authorization="Bearer collector",
            )
        require_auth.assert_called_once_with("Bearer collector")
        expected = init_segment() + media_fragment(1) + media_fragment(2)
        self.assertEqual(response.media_type, "video/mp4")
        self.assertEqual(Path(response.path).read_bytes(), expected)
        self.assertEqual(response.headers["x-dv-rpu-presence"], "unknown")
        self.assertRegex(response.headers["x-dv-hls-graph-sha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(response.headers["x-dv-hls-temporal-continuity"], "contiguous")
        self.assertEqual(response.headers["x-dv-hls-fragment-sequence-continuity"], "sequential")
        Path(response.path).unlink(missing_ok=True)

    def test_authenticated_api_streams_one_fragment_with_complete_provenance_headers(self):
        variant_id, _ = self.prepare_graph()
        staging_root = self.root / "segment-api-staging"
        with patch.object(queue, "DV_MEDIA_OBJECT_ROOT", self.object_root), \
                patch.object(queue, "DV_MEDIA_STAGING_ROOT", staging_root), \
                patch.object(queue, "require_auth") as require_auth:
            response = queue.api_assemble_hls_fmp4_segment(
                self.resource["id"], variant_id, 1, authorization="Bearer collector",
            )
        require_auth.assert_called_once_with("Bearer collector")
        expected = init_segment() + media_fragment(2)
        self.assertEqual(response.media_type, "video/mp4")
        self.assertEqual(Path(response.path).read_bytes(), expected)
        self.assertEqual(response.headers["x-dv-analysis-scope"], "hls-fmp4-segment")
        self.assertEqual(response.headers["x-dv-hls-fragment-ordinal"], "1")
        self.assertEqual(response.headers["x-dv-hls-fragment-count"], "2")
        self.assertEqual(response.headers["x-dv-hls-fragment-sequence-number"], "2")
        self.assertEqual(response.headers["x-dv-hls-decode-time"], "4000")
        self.assertEqual(response.headers["x-dv-hls-sample-duration"], "4000")
        self.assertEqual(response.headers["x-dv-hls-sample-count"], "1")
        self.assertEqual(
            response.headers["x-dv-asset-sha256"],
            hashlib.sha256(expected).hexdigest(),
        )
        self.assertEqual(
            response.headers["x-dv-hls-assembled-segment-sha256"],
            hashlib.sha256(expected).hexdigest(),
        )
        self.assertEqual(response.headers["x-dv-hls-temporal-continuity"], "contiguous")
        awaitable = response.background()
        if hasattr(awaitable, "__await__"):
            import asyncio
            asyncio.run(awaitable)

    def test_assembly_api_rejects_missing_collector_auth(self):
        from fastapi import HTTPException
        with patch.object(queue, "require_auth", side_effect=HTTPException(status_code=401)):
            with self.assertRaises(HTTPException):
                queue.api_assemble_hls_fmp4(
                    "resource-missing", "variant-missing", authorization=None,
                )

    def test_rejects_symlinked_content_addressed_shard_directory(self):
        variant_id, ingested = self.prepare_graph()
        digest = ingested["assets"]["seg1.m4s"]["sha256"]
        shard = self.object_root / "sha256" / digest[:2]
        moved = self.root / "moved-shard"
        shard.rename(moved)
        shard.symlink_to(moved, target_is_directory=True)
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
