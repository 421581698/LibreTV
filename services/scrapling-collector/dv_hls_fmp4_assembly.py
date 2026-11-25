#!/usr/bin/env python3
"""Assemble one verified, clear fMP4 HLS rendition for downstream DV RPU analysis.

This module never fetches URLs, retrieves keys, decrypts media, or claims RPU
presence. It accepts only a registered immutable HLS graph and verifies every
member against its content-addressed SHA-256 before assembling init + fragments.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
import time
from pathlib import Path
from typing import BinaryIO

import registry_queue as registry

MAX_PLAYLIST_BYTES = 2 * 1024 * 1024
MAX_ASSEMBLED_BYTES = 512 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
IMMUTABLE_URI = re.compile(r'^/api/dolby-vision/assets/([A-Za-z0-9:_-]{1,200})/content$')
MAP_URI = re.compile(r'URI="([^"]+)"')


class HlsAssemblyError(RuntimeError):
    pass


def _open_asset(object_root: Path, asset: dict) -> BinaryIO:
    digest = asset["sha256"]
    expected_key = f"sha256/{digest[:2]}/{digest}"
    if asset["object_key"] != expected_key or not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise HlsAssemblyError("Registered HLS member has an invalid content-addressed object key.")
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    file_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    root_descriptor = None
    hash_descriptor = None
    shard_descriptor = None
    try:
        root_descriptor = os.open(object_root, directory_flags)
        hash_descriptor = os.open("sha256", directory_flags, dir_fd=root_descriptor)
        shard_descriptor = os.open(digest[:2], directory_flags, dir_fd=hash_descriptor)
        descriptor = os.open(digest, file_flags, dir_fd=shard_descriptor)
    except OSError as exc:
        raise HlsAssemblyError("Registered HLS member object or its content-addressed directory is unavailable or unsafe.") from exc
    finally:
        if shard_descriptor is not None:
            os.close(shard_descriptor)
        if hash_descriptor is not None:
            os.close(hash_descriptor)
        if root_descriptor is not None:
            os.close(root_descriptor)
    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode) or info.st_size != asset["byte_length"]:
        os.close(descriptor)
        raise HlsAssemblyError("Registered media object size or file type does not match.")
    return os.fdopen(descriptor, "rb")

def _read_verified_bytes(object_root: Path, asset: dict, maximum: int) -> bytes:
    if asset["byte_length"] > maximum:
        raise HlsAssemblyError("HLS playlist exceeds the configured size limit.")
    digest = hashlib.sha256()
    chunks = []
    total = 0
    with _open_asset(object_root, asset) as source:
        for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
            total += len(chunk)
            if total > maximum:
                raise HlsAssemblyError("HLS playlist exceeds the configured size limit.")
            digest.update(chunk)
            chunks.append(chunk)
    if total != asset["byte_length"] or digest.hexdigest() != asset["sha256"]:
        raise HlsAssemblyError("Registered HLS playlist failed SHA-256 verification.")
    return b"".join(chunks)


def _top_level_boxes(source: BinaryIO, total_size: int) -> list[tuple[str, int, int, int]]:
    boxes = []
    offset = 0
    while offset < total_size:
        source.seek(offset)
        header = source.read(8)
        if len(header) != 8:
            raise HlsAssemblyError("Truncated ISO BMFF box header.")
        size32 = int.from_bytes(header[:4], "big")
        box_type = header[4:8].decode("ascii", errors="strict")
        header_size = 8
        if size32 == 1:
            extended = source.read(8)
            if len(extended) != 8:
                raise HlsAssemblyError("Truncated extended ISO BMFF box header.")
            box_size = int.from_bytes(extended, "big")
            header_size = 16
        elif size32 == 0:
            box_size = total_size - offset
        else:
            box_size = size32
        if box_size < header_size or offset + box_size > total_size:
            raise HlsAssemblyError("ISO BMFF box length is outside the registered member.")
        boxes.append((box_type, offset, box_size, header_size))
        offset += box_size
    if offset != total_size:
        raise HlsAssemblyError("ISO BMFF box boundaries do not cover the complete member.")
    return boxes


def _fragment_sequence(source: BinaryIO, moof: tuple[str, int, int, int]) -> int:
    _, moof_offset, moof_size, moof_header = moof
    cursor = moof_offset + moof_header
    end = moof_offset + moof_size
    while cursor < end:
        source.seek(cursor)
        header = source.read(8)
        if len(header) != 8:
            raise HlsAssemblyError("Truncated moof child box.")
        size32 = int.from_bytes(header[:4], "big")
        box_type = header[4:8].decode("ascii", errors="strict")
        header_size = 8
        if size32 == 1:
            extended = source.read(8)
            if len(extended) != 8:
                raise HlsAssemblyError("Truncated extended moof child box.")
            child_size = int.from_bytes(extended, "big")
            header_size = 16
        elif size32 == 0:
            child_size = end - cursor
        else:
            child_size = size32
        if child_size < header_size or cursor + child_size > end:
            raise HlsAssemblyError("Invalid moof child box length.")
        if box_type == "mfhd":
            if child_size < header_size + 8:
                raise HlsAssemblyError("mfhd box is too short.")
            version_and_flags = source.read(4)
            sequence = source.read(4)
            if len(version_and_flags) != 4 or len(sequence) != 4:
                raise HlsAssemblyError("Truncated mfhd sequence number.")
            return int.from_bytes(sequence, "big")
        cursor += child_size
    raise HlsAssemblyError("Fragment is missing its mfhd sequence number.")


def _child_boxes(source: BinaryIO, parent: tuple[str, int, int, int]) -> list[tuple[str, int, int, int]]:
    _, offset, size, header = parent
    cursor = offset + header
    end = offset + size
    children = []
    while cursor < end:
        source.seek(cursor)
        raw = source.read(8)
        if len(raw) != 8:
            raise HlsAssemblyError("Truncated nested ISO BMFF box header.")
        size32 = int.from_bytes(raw[:4], "big")
        kind = raw[4:8].decode("ascii", errors="strict")
        header_size = 8
        if size32 == 1:
            extended = source.read(8)
            if len(extended) != 8:
                raise HlsAssemblyError("Truncated extended nested box header.")
            box_size = int.from_bytes(extended, "big")
            header_size = 16
        elif size32 == 0:
            box_size = end - cursor
        else:
            box_size = size32
        if box_size < header_size or cursor + box_size > end:
            raise HlsAssemblyError("Nested ISO BMFF box length is invalid.")
        children.append((kind, cursor, box_size, header_size))
        cursor += box_size
    if cursor != end:
        raise HlsAssemblyError("Nested ISO BMFF boxes do not cover their parent.")
    return children


def _box_payload(source: BinaryIO, box: tuple[str, int, int, int]) -> bytes:
    _, offset, size, header = box
    source.seek(offset + header)
    payload = source.read(size - header)
    if len(payload) != size - header:
        raise HlsAssemblyError("Truncated ISO BMFF box payload.")
    return payload


def _read_video_track_timing(object_root: Path, asset: dict) -> tuple[int, int, int]:
    """Return (video track ID, mdhd timescale, trex default sample duration)."""
    with _open_asset(object_root, asset) as source:
        top = _top_level_boxes(source, asset["byte_length"])
        moov = next((item for item in top if item[0] == "moov"), None)
        if moov is None:
            raise HlsAssemblyError("Initialization segment is missing moov.")
        moov_children = _child_boxes(source, moov)
        tracks = []
        for trak in (item for item in moov_children if item[0] == "trak"):
            trak_children = _child_boxes(source, trak)
            tkhd = next((item for item in trak_children if item[0] == "tkhd"), None)
            mdia = next((item for item in trak_children if item[0] == "mdia"), None)
            if tkhd is None or mdia is None:
                continue
            tkhd_data = _box_payload(source, tkhd)
            if len(tkhd_data) < 20:
                raise HlsAssemblyError("Track header is truncated.")
            tkhd_version = tkhd_data[0]
            track_id_offset = 20 if tkhd_version == 1 else 12
            if len(tkhd_data) < track_id_offset + 4:
                raise HlsAssemblyError("Track ID is missing from tkhd.")
            track_id = int.from_bytes(tkhd_data[track_id_offset:track_id_offset + 4], "big")
            mdia_children = _child_boxes(source, mdia)
            hdlr = next((item for item in mdia_children if item[0] == "hdlr"), None)
            mdhd = next((item for item in mdia_children if item[0] == "mdhd"), None)
            if hdlr is None or mdhd is None:
                continue
            hdlr_data = _box_payload(source, hdlr)
            if len(hdlr_data) < 12:
                raise HlsAssemblyError("Handler declaration is truncated.")
            if hdlr_data[8:12] != b"vide":
                continue
            mdhd_data = _box_payload(source, mdhd)
            if len(mdhd_data) < 20:
                raise HlsAssemblyError("Media header is truncated.")
            mdhd_version = mdhd_data[0]
            timescale_offset = 20 if mdhd_version == 1 else 12
            if len(mdhd_data) < timescale_offset + 4:
                raise HlsAssemblyError("Video media timescale is missing.")
            timescale = int.from_bytes(mdhd_data[timescale_offset:timescale_offset + 4], "big")
            if track_id <= 0 or timescale <= 0:
                raise HlsAssemblyError("Video track ID and media timescale must be positive.")
            tracks.append((track_id, timescale))
        if len(tracks) != 1:
            raise HlsAssemblyError("Exactly one video track is required for HLS temporal continuity validation.")
        track_id, timescale = tracks[0]
        trex_defaults = []
        mvex = next((item for item in moov_children if item[0] == "mvex"), None)
        if mvex is not None:
            for trex in (item for item in _child_boxes(source, mvex) if item[0] == "trex"):
                data = _box_payload(source, trex)
                if len(data) < 24:
                    raise HlsAssemblyError("trex default sample declaration is truncated.")
                if int.from_bytes(data[4:8], "big") == track_id:
                    trex_defaults.append(int.from_bytes(data[12:16], "big"))
        if len(trex_defaults) > 1:
            raise HlsAssemblyError("Video track has ambiguous trex defaults.")
        return track_id, timescale, trex_defaults[0] if trex_defaults else 0


def _fragment_video_timing(
    object_root: Path,
    asset: dict,
    track_id: int,
    trex_default_duration: int,
) -> tuple[int, int, int]:
    """Return (tfdt decode time, total video sample duration, sample count)."""
    with _open_asset(object_root, asset) as source:
        top = _top_level_boxes(source, asset["byte_length"])
        moof = next((item for item in top if item[0] == "moof"), None)
        if moof is None:
            raise HlsAssemblyError("Media fragment is missing moof.")
        matching = []
        for traf in (item for item in _child_boxes(source, moof) if item[0] == "traf"):
            children = _child_boxes(source, traf)
            tfhd = next((item for item in children if item[0] == "tfhd"), None)
            tfdt = next((item for item in children if item[0] == "tfdt"), None)
            truns = [item for item in children if item[0] == "trun"]
            if tfhd is None or tfdt is None or not truns:
                continue
            tfhd_data = _box_payload(source, tfhd)
            if len(tfhd_data) < 8:
                raise HlsAssemblyError("tfhd is truncated.")
            flags = int.from_bytes(tfhd_data[1:4], "big")
            fragment_track_id = int.from_bytes(tfhd_data[4:8], "big")
            if fragment_track_id != track_id:
                continue
            cursor = 8
            if flags & 0x000001:
                cursor += 8
            if flags & 0x000002:
                cursor += 4
            default_duration = trex_default_duration
            if flags & 0x000008:
                if len(tfhd_data) < cursor + 4:
                    raise HlsAssemblyError("tfhd default sample duration is truncated.")
                default_duration = int.from_bytes(tfhd_data[cursor:cursor + 4], "big")
            tfdt_data = _box_payload(source, tfdt)
            if len(tfdt_data) < 8:
                raise HlsAssemblyError("tfdt is truncated.")
            tfdt_version = tfdt_data[0]
            decode_offset = 4
            decode_size = 8 if tfdt_version == 1 else 4
            if tfdt_version not in (0, 1) or len(tfdt_data) < decode_offset + decode_size:
                raise HlsAssemblyError("tfdt version or decode timestamp is invalid.")
            decode_time = int.from_bytes(tfdt_data[decode_offset:decode_offset + decode_size], "big")
            duration_sum = 0
            total_sample_count = 0
            for trun in truns:
                data = _box_payload(source, trun)
                if len(data) < 8:
                    raise HlsAssemblyError("trun is truncated.")
                trun_flags = int.from_bytes(data[1:4], "big")
                sample_count = int.from_bytes(data[4:8], "big")
                if sample_count <= 0 or sample_count > 1_000_000:
                    raise HlsAssemblyError("trun sample count is invalid.")
                total_sample_count += sample_count
                position = 8
                if trun_flags & 0x000001:
                    position += 4
                if trun_flags & 0x000004:
                    position += 4
                for _ in range(sample_count):
                    if trun_flags & 0x000100:
                        if len(data) < position + 4:
                            raise HlsAssemblyError("trun sample duration is truncated.")
                        duration = int.from_bytes(data[position:position + 4], "big")
                        position += 4
                    else:
                        duration = default_duration
                    if trun_flags & 0x000200:
                        position += 4
                    if trun_flags & 0x000400:
                        position += 4
                    if trun_flags & 0x000800:
                        position += 4
                    if duration <= 0 or position > len(data):
                        raise HlsAssemblyError("Every video sample must have a known positive duration.")
                    duration_sum += duration
                    if duration_sum > 2**64 - 1:
                        raise HlsAssemblyError("Fragment sample duration overflows the media timeline.")
                if position != len(data):
                    raise HlsAssemblyError("trun contains unsupported trailing or malformed sample data.")
            matching.append((decode_time, duration_sum, total_sample_count))
        if len(matching) != 1:
            raise HlsAssemblyError("Each media fragment must contain exactly one timed video traf.")
        return matching[0]


def _validate_video_timeline(
    object_root: Path,
    init_asset: dict,
    segment_assets: list[dict],
) -> list[dict[str, int]]:
    track_id, timescale, trex_default = _read_video_track_timing(object_root, init_asset)
    timeline = []
    previous_end = None
    for index, asset in enumerate(segment_assets):
        decode_time, duration, sample_count = _fragment_video_timing(object_root, asset, track_id, trex_default)
        if previous_end is not None and decode_time != previous_end:
            raise HlsAssemblyError("Video tfdt timestamps are not continuous with preceding sample durations.")
        previous_end = decode_time + duration
        if previous_end > 2**64 - 1:
            raise HlsAssemblyError("Video decode timeline overflows its supported range.")
        timeline.append({
            "ordinal": index,
            "decodeTime": decode_time,
            "sampleDuration": duration,
            "sampleCount": sample_count,
            "endDecodeTime": previous_end,
            "timescale": timescale,
        })
    return timeline


def _validate_init(object_root: Path, asset: dict) -> None:
    with _open_asset(object_root, asset) as source:
        boxes = _top_level_boxes(source, asset["byte_length"])
    types = [item[0] for item in boxes]
    if "ftyp" not in types or "moov" not in types:
        raise HlsAssemblyError("Initialization segment must contain ftyp and moov boxes.")


def _validate_fragment(object_root: Path, asset: dict) -> int:
    with _open_asset(object_root, asset) as source:
        boxes = _top_level_boxes(source, asset["byte_length"])
        types = [item[0] for item in boxes]
        if types.count("moof") != 1 or types.count("mdat") != 1:
            raise HlsAssemblyError("Each HLS media fragment must contain exactly one moof and one mdat box.")
        moof = next(item for item in boxes if item[0] == "moof")
        mdat = next(item for item in boxes if item[0] == "mdat")
        if moof[1] >= mdat[1]:
            raise HlsAssemblyError("Fragment moof must precede mdat.")
        return _fragment_sequence(source, moof)


def _copy_verified_asset(object_root: Path, asset: dict, target: BinaryIO, total_written: int) -> tuple[int, str]:
    digest = hashlib.sha256()
    copied = 0
    with _open_asset(object_root, asset) as source:
        while True:
            chunk = source.read(CHUNK_SIZE)
            if not chunk:
                break
            copied += len(chunk)
            if total_written + copied > MAX_ASSEMBLED_BYTES:
                raise HlsAssemblyError("Assembled HLS input exceeds the configured parser upload limit.")
            digest.update(chunk)
            target.write(chunk)
    actual = digest.hexdigest()
    if copied != asset["byte_length"] or actual != asset["sha256"]:
        raise HlsAssemblyError("Registered HLS member failed SHA-256 verification during assembly.")
    return copied, actual



_VALIDATED_GRAPH_CACHE: dict[tuple[str, str, str], dict] = {}
_VALIDATED_GRAPH_CACHE_TTL_SECONDS = 20 * 60
_VALIDATED_GRAPH_CACHE_MAX_ENTRIES = 16


def _cached_graph_entry(
    resource_id: str,
    variant_asset_id: str,
    object_root: Path,
) -> dict | None:
    key = (resource_id, variant_asset_id, str(object_root))
    entry = _VALIDATED_GRAPH_CACHE.get(key)
    if entry is None:
        return None
    if time.monotonic() - entry["cachedAt"] > _VALIDATED_GRAPH_CACHE_TTL_SECONDS:
        _VALIDATED_GRAPH_CACHE.pop(key, None)
        return None

    # Re-check live registry state and the small playlist objects on every hit.
    # Media members remain content-addressed and are SHA-256 checked when copied.
    with registry.connect() as connection:
        resource = connection.execute(
            """SELECT id,resource_type,access_state,validation_state,playback_state,media_format
               FROM registry_resources WHERE id=?""",
            (resource_id,),
        ).fetchone()
        graph = connection.execute(
            """SELECT graph_id,root_asset_id FROM registry_hls_asset_graphs
               WHERE resource_id=? ORDER BY created_at DESC,graph_id DESC LIMIT 1""",
            (resource_id,),
        ).fetchone()
        root_asset = connection.execute(
            """SELECT asset_id,resource_id,sha256,byte_length,content_type,object_key
               FROM registry_media_assets WHERE asset_id=? AND resource_id=?""",
            (entry["rootAssetId"], resource_id),
        ).fetchone()
        variant = connection.execute(
            """SELECT asset_id,resource_id,sha256,byte_length,content_type,object_key
               FROM registry_media_assets WHERE asset_id=? AND resource_id=?""",
            (variant_asset_id, resource_id),
        ).fetchone()

    if (not resource or not graph or not root_asset or not variant or
            graph["graph_id"] != entry["graphId"] or
            graph["root_asset_id"] != entry["rootAssetId"] or
            resource["resource_type"] != "DIRECT_MEDIA" or
            resource["access_state"] != "PUBLIC" or
            resource["validation_state"] != "validated" or
            resource["playback_state"] != "PLAYER_CONFIRMED" or
            resource["media_format"] != "hls" or
            variant["content_type"] != "application/vnd.apple.mpegurl"):
        _VALIDATED_GRAPH_CACHE.pop(key, None)
        return None

    for current, cached in ((root_asset, entry["rootAsset"]), (variant, entry["variant"])):
        if any(current[field] != cached[field] for field in ("asset_id", "sha256", "byte_length", "content_type", "object_key")):
            _VALIDATED_GRAPH_CACHE.pop(key, None)
            return None
    try:
        _read_verified_bytes(object_root, dict(root_asset), MAX_PLAYLIST_BYTES)
        _read_verified_bytes(object_root, dict(variant), MAX_PLAYLIST_BYTES)
    except HlsAssemblyError:
        _VALIDATED_GRAPH_CACHE.pop(key, None)
        return None
    return entry


def _assemble_cached_fragment(
    entry: dict,
    fragment_ordinal: int,
    output_path: str | Path,
    object_root: Path,
) -> dict:
    segment_assets = entry["segmentAssets"]
    if fragment_ordinal < 0 or fragment_ordinal >= len(segment_assets):
        raise HlsAssemblyError("Requested HLS fragment ordinal is outside the registered rendition.")
    asset = segment_assets[fragment_ordinal]
    init_asset = entry["initAsset"]
    timing = entry["timeline"][fragment_ordinal]
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_segment = None
    digest = hashlib.sha256()
    total = 0
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=".dv-hls-segment-", suffix=".mp4",
            dir=destination.parent, delete=False,
        ) as target:
            temporary_segment = Path(target.name)
            for member in (init_asset, asset):
                copied, _ = _copy_verified_asset(object_root, member, target, total)
                total += copied
            target.flush()
            os.fsync(target.fileno())
        with temporary_segment.open("rb") as assembled:
            for chunk in iter(lambda: assembled.read(CHUNK_SIZE), b""):
                digest.update(chunk)
        os.replace(temporary_segment, destination)
    except Exception:
        if temporary_segment is not None:
            temporary_segment.unlink(missing_ok=True)
        raise

    segment = {
        **timing,
        "fragmentSequenceNumber": entry["sequenceNumbers"][fragment_ordinal],
        "fragmentAssetId": asset["child_asset_id"],
        "fragmentSha256": asset["sha256"],
        "fragmentByteLength": asset["byte_length"],
        "initializationAssetId": init_asset["child_asset_id"],
        "initializationSha256": init_asset["sha256"],
        "assembledSegmentByteLength": total,
        "assembledSegmentSha256": digest.hexdigest(),
        "outputPath": str(destination),
    }
    return {
        "resourceId": entry["resourceId"],
        "graphId": entry["graphId"],
        "graphDigest": entry["graphDigest"],
        "graphManifest": entry["graphManifest"],
        "rootAssetId": entry["rootAssetId"],
        "variantAssetId": entry["variantAssetId"],
        "initializationAssetId": entry["mapIds"][0],
        "segmentAssetIds": entry["segmentIds"],
        "fragmentSequenceNumbers": entry["sequenceNumbers"],
        "fragmentSequenceContinuity": "sequential",
        "temporalContinuity": "contiguous",
        "videoTimeline": entry["timeline"],
        "segmentInputs": [segment],
        "assembledByteLength": total,
        "assembledSha256": digest.hexdigest(),
        "outputPath": str(destination),
        "rpuPresence": "unknown",
        "notes": [
            "Assembled from SHA-256-verified registered clear fMP4 HLS members.",
            "Video tfdt decode timestamps exactly follow the preceding fragment's summed sample durations.",
            "Cached graph metadata is re-bound to live registry state; initialization and requested fragment bytes are SHA-256 verified for each response.",
        ],
    }


def assemble_registered_hls_fmp4(
    resource_id: str,
    variant_asset_id: str,
    output_path: str | Path,
    object_root: str | Path | None = None,
    fragment_ordinal: int | None = None,
) -> dict:
    """Assemble a single clear VOD fMP4 rendition from its verified immutable graph."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", resource_id):
        raise HlsAssemblyError("Invalid registry resource ID.")
    if not re.fullmatch(r"[A-Za-z0-9:_-]{1,200}", variant_asset_id):
        raise HlsAssemblyError("Invalid HLS variant asset ID.")
    root_dir = Path(object_root) if object_root is not None else registry.DV_MEDIA_OBJECT_ROOT

    if isinstance(fragment_ordinal, int) and not isinstance(fragment_ordinal, bool):
        cached = _cached_graph_entry(resource_id, variant_asset_id, root_dir)
        if cached is not None:
            return _assemble_cached_fragment(cached, fragment_ordinal, output_path, root_dir)

    with registry.connect() as connection:
        resource = connection.execute(
            """SELECT id,resource_type,access_state,validation_state,playback_state,media_format
               FROM registry_resources WHERE id=?""",
            (resource_id,),
        ).fetchone()
        graph = connection.execute(
            """SELECT graph_id,root_asset_id FROM registry_hls_asset_graphs
               WHERE resource_id=? ORDER BY created_at DESC,graph_id DESC LIMIT 1""",
            (resource_id,),
        ).fetchone()
        root_asset = connection.execute(
            """SELECT asset_id,resource_id,sha256,byte_length,content_type,object_key
               FROM registry_media_assets WHERE asset_id=? AND resource_id=?""",
            (graph["root_asset_id"], resource_id),
        ).fetchone() if graph else None
        variant = connection.execute(
            """SELECT asset_id,resource_id,sha256,byte_length,content_type,object_key
               FROM registry_media_assets WHERE asset_id=? AND resource_id=?""",
            (variant_asset_id, resource_id),
        ).fetchone()
        if not resource or not graph or not root_asset or not variant:
            raise HlsAssemblyError("Verified HLS resource, graph, or selected variant was not found.")
        if (resource["resource_type"] != "DIRECT_MEDIA" or resource["access_state"] != "PUBLIC" or
                resource["validation_state"] != "validated" or resource["playback_state"] != "PLAYER_CONFIRMED" or
                resource["media_format"] != "hls" or variant["content_type"] != "application/vnd.apple.mpegurl"):
            raise HlsAssemblyError("HLS assembly requires a validated PUBLIC player-confirmed HLS playlist.")
        root_edge = connection.execute(
            """SELECT 1 FROM registry_hls_asset_edges
               WHERE parent_asset_id=? AND child_asset_id=? AND role='playlist'""",
            (graph["root_asset_id"], variant_asset_id),
        ).fetchone()
        if variant_asset_id != graph["root_asset_id"] and not root_edge:
            raise HlsAssemblyError("Selected playlist is not a direct variant of the registered root playlist.")
        edges = connection.execute(
            """SELECT edge.child_asset_id,edge.relative_uri,edge.role,edge.ordinal,
                      asset.resource_id,asset.sha256,asset.byte_length,asset.content_type,asset.object_key
               FROM registry_hls_asset_edges edge
               JOIN registry_media_assets asset ON asset.asset_id=edge.child_asset_id
               WHERE edge.parent_asset_id=? AND asset.resource_id=?
               ORDER BY edge.ordinal""",
            (variant_asset_id, resource_id),
        ).fetchall()
        assets = {row["child_asset_id"]: dict(row) for row in edges}

    if root_asset["content_type"] != "application/vnd.apple.mpegurl":
        raise HlsAssemblyError("Registered HLS graph root must be a playlist asset.")
    # Verify the root playlist bytes as well as its registry identity before
    # including its digest in the signed-analysis provenance manifest.
    _read_verified_bytes(root_dir, dict(root_asset), MAX_PLAYLIST_BYTES)
    playlist_bytes = _read_verified_bytes(root_dir, dict(variant), MAX_PLAYLIST_BYTES)
    try:
        playlist = playlist_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HlsAssemblyError("Registered HLS media playlist is not UTF-8.") from exc
    if not playlist.lstrip().startswith("#EXTM3U") or "#EXT-X-ENDLIST" not in playlist.upper():
        raise HlsAssemblyError("Only finalized HLS VOD media playlists can be assembled.")
    upper = playlist.upper()
    forbidden = (
        "#EXT-X-DISCONTINUITY", "#EXT-X-BYTERANGE", "#EXT-X-PART:",
        "#EXT-X-PRELOAD-HINT:", "#EXT-X-SKIP:", "#EXT-X-GAP:",
        "#EXT-X-I-FRAMES-ONLY", "#EXT-X-SESSION-KEY:",
    )
    if any(marker in upper for marker in forbidden):
        raise HlsAssemblyError("Discontinuities, byte ranges, low-latency parts, gaps, or session keys are not supported.")
    for line in playlist.splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("#EXT-X-KEY:"):
            method = re.search(r"(?:^|,)\s*METHOD=([^,]+)", stripped.split(":", 1)[1], re.IGNORECASE)
            if not method or method.group(1).strip().strip('"').upper() != "NONE":
                raise HlsAssemblyError("Encrypted or DRM HLS playlists cannot be assembled.")

    map_ids = []
    segment_ids = []
    expect_segment_uri = False
    for line in playlist.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.upper().startswith("#EXT-X-MAP:"):
            matches = MAP_URI.findall(stripped)
            if len(matches) != 1:
                raise HlsAssemblyError("Exactly one quoted EXT-X-MAP URI is required.")
            match = IMMUTABLE_URI.fullmatch(matches[0])
            if not match:
                raise HlsAssemblyError("Initialization URI is not an immutable registered asset URL.")
            map_ids.append(match.group(1))
        elif stripped.upper().startswith("#EXTINF:"):
            if expect_segment_uri:
                raise HlsAssemblyError("A playlist EXTINF entry is missing its media URI.")
            expect_segment_uri = True
        elif stripped.startswith("#"):
            continue
        else:
            if not expect_segment_uri:
                raise HlsAssemblyError("Unexpected URI outside an EXTINF media segment.")
            match = IMMUTABLE_URI.fullmatch(stripped)
            if not match:
                raise HlsAssemblyError("Media segment URI is not an immutable registered asset URL.")
            segment_ids.append(match.group(1))
            expect_segment_uri = False
    if expect_segment_uri or len(map_ids) != 1 or not segment_ids:
        raise HlsAssemblyError("HLS playlist must contain one initialization segment and at least one complete media segment.")
    expected_children = [map_ids[0], *segment_ids]
    actual_children = [row["child_asset_id"] for row in edges]
    actual_roles = [row["role"] for row in edges]
    if actual_children != expected_children or actual_roles != ["initialization", *("segment" for _ in segment_ids)]:
        raise HlsAssemblyError("Playlist member order does not exactly match the registered immutable graph edges.")
    if map_ids[0] not in assets or assets[map_ids[0]]["content_type"] != "video/mp4":
        raise HlsAssemblyError("fMP4 initialization asset is missing or has an unsupported content type.")
    segment_assets = []
    for asset_id in segment_ids:
        asset = assets.get(asset_id)
        if not asset or asset["content_type"] != "video/iso.segment":
            raise HlsAssemblyError("Only registered fMP4 media segments are supported; MPEG-TS and audio segments are rejected.")
        segment_assets.append(asset)

    init_asset = assets[map_ids[0]]
    _validate_init(root_dir, init_asset)
    timeline = _validate_video_timeline(root_dir, init_asset, segment_assets)

    sequence_numbers = []
    previous_sequence = None
    for asset in segment_assets:
        sequence = _validate_fragment(root_dir, asset)
        if previous_sequence is not None and sequence != previous_sequence + 1:
            raise HlsAssemblyError("Fragment sequence numbers are not contiguous; cross-fragment continuity is unknown.")
        previous_sequence = sequence
        sequence_numbers.append(sequence)

    # Bind the analysis input to a deterministic digest of the exact registered
    # root/variant/init/segment identities and their order. This is provenance,
    # not a substitute for the later Ed25519 parser signature.
    graph_manifest = {
        "version": 1,
        "resourceId": resource_id,
        "graphId": graph["graph_id"],
        "root": {
            "assetId": root_asset["asset_id"],
            "sha256": root_asset["sha256"],
            "byteLength": root_asset["byte_length"],
            "contentType": root_asset["content_type"],
        },
        "variant": {
            "assetId": variant["asset_id"],
            "sha256": variant["sha256"],
            "byteLength": variant["byte_length"],
            "contentType": variant["content_type"],
        },
        "members": [
            {
                "role": role,
                "ordinal": ordinal,
                "assetId": asset.get("asset_id", asset.get("child_asset_id")),
                "sha256": asset["sha256"],
                "byteLength": asset["byte_length"],
                "contentType": asset["content_type"],
            }
            for ordinal, (role, asset) in enumerate(
                [("initialization", init_asset), *(("segment", item) for item in segment_assets)]
            )
        ],
        "fragmentSequenceNumbers": sequence_numbers,
        "videoTimeline": timeline,
    }
    graph_digest = hashlib.sha256(
        json.dumps(graph_manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    ).hexdigest()

    if fragment_ordinal is not None and (
        not isinstance(fragment_ordinal, int) or fragment_ordinal < 0 or fragment_ordinal >= len(segment_assets)
    ):
        raise HlsAssemblyError("Requested HLS fragment ordinal is outside the registered rendition.")

    cache_key = (resource_id, variant_asset_id, str(root_dir))
    _VALIDATED_GRAPH_CACHE[cache_key] = {
        "cachedAt": time.monotonic(),
        "resourceId": resource_id,
        "graphId": graph["graph_id"],
        "graphDigest": graph_digest,
        "graphManifest": graph_manifest,
        "rootAssetId": root_asset["asset_id"],
        "rootAsset": dict(root_asset),
        "variant": dict(variant),
        "variantAssetId": variant_asset_id,
        "initAsset": dict(init_asset),
        "segmentAssets": [dict(asset) for asset in segment_assets],
        "segmentIds": segment_ids,
        "mapIds": map_ids,
        "sequenceNumbers": sequence_numbers,
        "timeline": timeline,
    }
    if len(_VALIDATED_GRAPH_CACHE) > _VALIDATED_GRAPH_CACHE_MAX_ENTRIES:
        oldest = min(_VALIDATED_GRAPH_CACHE, key=lambda cache_key: _VALIDATED_GRAPH_CACHE[cache_key]["cachedAt"])
        _VALIDATED_GRAPH_CACHE.pop(oldest, None)
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    total = 0
    digest = hashlib.sha256()
    segment_inputs = []

    if fragment_ordinal is None:
        members = [init_asset, *segment_assets]
        try:
            with tempfile.NamedTemporaryFile(mode="wb", prefix=".dv-hls-", suffix=".mp4", dir=destination.parent, delete=False) as target:
                temporary_path = Path(target.name)
                for asset in members:
                    before = target.tell()
                    copied, _ = _copy_verified_asset(root_dir, asset, target, total)
                    total += copied
                    target.flush()
                    if target.tell() - before != copied:
                        raise HlsAssemblyError("Assembled HLS byte count mismatch.")
            with temporary_path.open("rb") as assembled:
                for chunk in iter(lambda: assembled.read(CHUNK_SIZE), b""):
                    digest.update(chunk)
            os.replace(temporary_path, destination)
        except Exception:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            raise

        # Full-rendition callers also receive one parser input per fragment.
        segment_output_dir = destination.with_name(destination.name + ".segments")
        segment_output_dir.mkdir(parents=True, exist_ok=True)
        selected_ordinals = range(len(segment_assets))
    else:
        # Fragment-only API calls avoid rebuilding the full rendition and
        # avoid materializing every sidecar on each individual fragment fetch.
        segment_output_dir = None
        selected_ordinals = (fragment_ordinal,)

    for ordinal in selected_ordinals:
        asset = segment_assets[ordinal]
        timing = timeline[ordinal]
        segment_path = (
            segment_output_dir / f"segment-{ordinal:06d}.mp4"
            if segment_output_dir is not None else destination
        )
        temporary_segment = None
        segment_digest = hashlib.sha256()
        segment_bytes = 0
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb", prefix=".dv-hls-segment-", suffix=".mp4",
                dir=segment_output_dir or destination.parent, delete=False,
            ) as target:
                temporary_segment = Path(target.name)
                for member in (init_asset, asset):
                    copied, _ = _copy_verified_asset(root_dir, member, target, segment_bytes)
                    segment_bytes += copied
                target.flush()
                os.fsync(target.fileno())
            with temporary_segment.open("rb") as assembled_segment:
                for chunk in iter(lambda: assembled_segment.read(CHUNK_SIZE), b""):
                    segment_digest.update(chunk)
            os.replace(temporary_segment, segment_path)
        except Exception:
            if temporary_segment is not None:
                temporary_segment.unlink(missing_ok=True)
            raise
        segment_inputs.append({
            **timing,
            "fragmentSequenceNumber": sequence_numbers[ordinal],
            "fragmentAssetId": asset["child_asset_id"],
            "fragmentSha256": asset["sha256"],
            "fragmentByteLength": asset["byte_length"],
            "initializationAssetId": init_asset["child_asset_id"],
            "initializationSha256": init_asset["sha256"],
            "assembledSegmentByteLength": segment_bytes,
            "assembledSegmentSha256": segment_digest.hexdigest(),
            "outputPath": str(segment_path),
        })
        if fragment_ordinal is not None:
            total = segment_bytes
            digest = segment_digest

    return {
        "resourceId": resource_id,
        "graphId": graph["graph_id"],
        "graphDigest": graph_digest,
        "graphManifest": graph_manifest,
        "rootAssetId": root_asset["asset_id"],
        "variantAssetId": variant_asset_id,
        "initializationAssetId": map_ids[0],
        "segmentAssetIds": segment_ids,
        "fragmentSequenceNumbers": sequence_numbers,
        "fragmentSequenceContinuity": "sequential",
        "temporalContinuity": "contiguous",
        "videoTimeline": timeline,
        "segmentInputs": segment_inputs,
        "assembledByteLength": total,
        "assembledSha256": digest.hexdigest(),
        "outputPath": str(destination),
        "rpuPresence": "unknown",
        "notes": [
            "Assembled from SHA-256-verified registered clear fMP4 HLS members.",
            "Video tfdt decode timestamps exactly follow the preceding fragment's summed sample durations.",
            "This is a parser input preparation step, not Dolby Vision RPU extraction or cross-segment RPU validation.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Assemble one verified clear fMP4 HLS rendition for Dolby Vision analysis.")
    parser.add_argument("--resource-id", required=True)
    parser.add_argument("--variant-asset-id", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--object-root", default=os.environ.get("DV_MEDIA_OBJECT_ROOT", "/data/dv-media-objects"))
    args = parser.parse_args()
    result = assemble_registered_hls_fmp4(args.resource_id, args.variant_asset_id, args.output, args.object_root)
    print(
        f"Prepared HLS RPU parser input resource={result['resourceId']} "
        f"segments={len(result['segmentAssetIds'])} bytes={result['assembledByteLength']} "
        f"sha256={result['assembledSha256']} rpu={result['rpuPresence']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
