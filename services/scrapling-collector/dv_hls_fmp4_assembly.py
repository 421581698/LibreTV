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


def assemble_registered_hls_fmp4(
    resource_id: str,
    variant_asset_id: str,
    output_path: str | Path,
    object_root: str | Path | None = None,
) -> dict:
    """Assemble a single clear VOD fMP4 rendition from its verified immutable graph."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", resource_id):
        raise HlsAssemblyError("Invalid registry resource ID.")
    if not re.fullmatch(r"[A-Za-z0-9:_-]{1,200}", variant_asset_id):
        raise HlsAssemblyError("Invalid HLS variant asset ID.")
    root_dir = Path(object_root) if object_root is not None else registry.DV_MEDIA_OBJECT_ROOT

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
    }
    graph_digest = hashlib.sha256(
        json.dumps(graph_manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    ).hexdigest()

    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    total = 0
    digest = hashlib.sha256()
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
        "temporalContinuity": "unknown",
        "assembledByteLength": total,
        "assembledSha256": digest.hexdigest(),
        "outputPath": str(destination),
        "rpuPresence": "unknown",
        "notes": [
            "Assembled from SHA-256-verified registered clear fMP4 HLS members.",
            "Fragment sequence numbers are sequential; tfdt/sample-duration timestamp continuity has not been validated.",
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
