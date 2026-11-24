#!/usr/bin/env python3
"""Build a trusted immutable HLS asset graph from an already-staged local directory.

No URL fetching, redirects, key retrieval, or decryption is performed here.
Encrypted/DRM playlists are deliberately rejected.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import stat
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import BinaryIO
from urllib.parse import unquote, urlsplit

import registry_queue as registry

MAX_MEMBER_BYTES = 2 * 1024 * 1024 * 1024
MAX_PLAYLIST_BYTES = 2 * 1024 * 1024
MAX_GRAPH_MEMBERS = 10_000
MAX_GRAPH_EDGES = 50_000
MAX_GRAPH_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
MAX_PLAYLIST_DEPTH = 16
CHUNK_SIZE = 1024 * 1024
CONTENT_TYPES = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".m4s": "video/iso.segment",
    ".mp4": "video/mp4",
    ".ts": "video/mp2t",
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".vtt": "text/vtt",
}
URI_ATTRIBUTE = re.compile(r'URI="([^"]+)"')


class HlsIngestionError(RuntimeError):
    pass


def _safe_relative_uri(raw_uri: str) -> str:
    if not isinstance(raw_uri, str) or not raw_uri or len(raw_uri) > 2048:
        raise HlsIngestionError("Invalid HLS member URI.")
    parsed = urlsplit(raw_uri)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or parsed.path.startswith("/"):
        raise HlsIngestionError("Only local relative HLS member paths are accepted.")
    decoded = unquote(parsed.path)
    if not decoded or "\\" in decoded or "\x00" in decoded:
        raise HlsIngestionError("Invalid HLS member path.")
    path = PurePosixPath(decoded)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise HlsIngestionError("HLS member path traversal is not allowed.")
    return path.as_posix()


def _open_regular(path: Path) -> int:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise HlsIngestionError("Cannot safely open staged HLS member.") from exc
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        os.close(fd)
        raise HlsIngestionError("HLS members must be regular files.")
    return fd


def _verify_existing_object(path: Path, expected_digest: str, expected_length: int) -> None:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise HlsIngestionError("Existing HLS object cannot be safely opened.") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size != expected_length:
            raise HlsIngestionError("Existing HLS object metadata does not match.")
        digest = hashlib.sha256()
        size = 0
        with os.fdopen(fd, "rb", closefd=False) as existing:
            for chunk in iter(lambda: existing.read(CHUNK_SIZE), b""):
                size += len(chunk)
                digest.update(chunk)
        if size != expected_length or digest.hexdigest() != expected_digest:
            raise HlsIngestionError("Existing immutable HLS object failed digest verification.")
    finally:
        os.close(fd)


def _store_stream(resource_id: str, source: BinaryIO, content_type: str, object_root: Path, limit: int) -> dict:
    digest_builder = hashlib.sha256()
    total = 0
    while True:
        chunk = source.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HlsIngestionError("HLS member exceeds the configured size limit.")
        digest_builder.update(chunk)
    if total <= 0:
        raise HlsIngestionError("Empty HLS members cannot be registered.")
    digest = digest_builder.hexdigest()
    source.seek(0)
    relative_key = Path("sha256") / digest[:2] / digest
    destination_dir = object_root / relative_key.parent
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = object_root / relative_key
    if destination.exists() or destination.is_symlink():
        _verify_existing_object(destination, digest, total)
    else:
        fd, name = tempfile.mkstemp(prefix=".hls-ingest-", dir=destination_dir)
        temporary = Path(name)
        try:
            with os.fdopen(fd, "wb") as target:
                copied = hashlib.sha256()
                copied_size = 0
                for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
                    copied.update(chunk)
                    copied_size += len(chunk)
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            if copied_size != total or copied.hexdigest() != digest:
                raise HlsIngestionError("HLS member changed during ingestion.")
            try:
                os.link(temporary, destination, follow_symlinks=False)
            except FileExistsError:
                # Another worker won the content-addressed race; verify its object.
                _verify_existing_object(destination, digest, total)
            directory_fd = os.open(destination_dir, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
    asset = registry.register_dolby_vision_media_asset(resource_id, digest, total, content_type)
    return asset


def _store_bytes(resource_id: str, payload: bytes, content_type: str, object_root: Path) -> dict:
    import io
    return _store_stream(resource_id, io.BytesIO(payload), content_type, object_root, MAX_PLAYLIST_BYTES)


def ingest_hls_directory(
    resource_id: str,
    staging_root: str | Path,
    root_playlist: str | Path,
    object_root: str | Path,
) -> dict:
    """Ingest a local clear-HLS graph and rewrite every URI to immutable asset URLs."""
    root = Path(staging_root).resolve(strict=True)
    requested_playlist = Path(root_playlist)
    if not requested_playlist.is_absolute():
        requested_playlist = root / requested_playlist
    requested_playlist = Path(os.path.abspath(requested_playlist))
    try:
        root_relative_path = requested_playlist.relative_to(root)
    except ValueError as exc:
        raise HlsIngestionError("Root playlist must be inside the trusted staging directory.") from exc
    current = root
    for part in root_relative_path.parts:
        current = current / part
        try:
            if stat.S_ISLNK(current.lstat().st_mode):
                raise HlsIngestionError("Symlinked root playlists are not accepted.")
        except FileNotFoundError as exc:
            raise HlsIngestionError("Root playlist is missing from the staging directory.") from exc
    playlist_path = requested_playlist.resolve(strict=True)
    if not playlist_path.is_relative_to(root):
        raise HlsIngestionError("Root playlist must be inside the trusted staging directory.")
    object_dir = Path(object_root)
    with registry.connect() as connection:
        resource = connection.execute(
            """SELECT resource_type,access_state,validation_state,playback_state,media_format
               FROM registry_resources WHERE id=?""",
            (resource_id,),
        ).fetchone()
    if not resource:
        raise HlsIngestionError("Registry resource does not exist.")
    if (resource["resource_type"] != "DIRECT_MEDIA" or resource["access_state"] != "PUBLIC" or
            resource["validation_state"] != "validated" or resource["playback_state"] != "PLAYER_CONFIRMED" or
            resource["media_format"] != "hls"):
        raise HlsIngestionError("HLS ingestion requires a validated PUBLIC player-confirmed HLS resource.")

    completed: dict[str, dict] = {}
    visiting: set[str] = set()
    edges: list[tuple[str, str, str, str, int]] = []
    total_graph_bytes = 0

    def ingest_member(relative_path: str, depth: int = 0) -> dict:
        nonlocal total_graph_bytes
        if depth > MAX_PLAYLIST_DEPTH or len(completed) >= MAX_GRAPH_MEMBERS:
            raise HlsIngestionError("HLS graph exceeds its member or nesting limit.")
        relative_path = _safe_relative_uri(relative_path)
        if relative_path in completed:
            return completed[relative_path]
        if relative_path in visiting:
            raise HlsIngestionError("Cyclic HLS playlist references are not supported.")
        candidate_path = root.joinpath(*PurePosixPath(relative_path).parts)
        current = root
        for part in PurePosixPath(relative_path).parts:
            current = current / part
            try:
                if stat.S_ISLNK(current.lstat().st_mode):
                    raise HlsIngestionError("Symlinked HLS members are not accepted.")
            except FileNotFoundError as exc:
                raise HlsIngestionError("HLS member is missing from the staging directory.") from exc
        source_path = candidate_path.resolve(strict=True)
        if not source_path.is_relative_to(root):
            raise HlsIngestionError("HLS member escaped the staging directory.")
        suffix = source_path.suffix.lower()
        content_type = CONTENT_TYPES.get(suffix)
        if not content_type:
            raise HlsIngestionError("Unsupported HLS member extension.")
        if suffix != ".m3u8":
            fd = _open_regular(source_path)
            info = os.fstat(fd)
            if info.st_size <= 0 or info.st_size > MAX_MEMBER_BYTES or total_graph_bytes + info.st_size > MAX_GRAPH_TOTAL_BYTES:
                os.close(fd)
                raise HlsIngestionError("HLS graph exceeds its aggregate media size limit.")
            total_graph_bytes += info.st_size
            with os.fdopen(fd, "rb") as source:
                asset = _store_stream(resource_id, source, content_type, object_dir, MAX_MEMBER_BYTES)
            completed[relative_path] = asset
            return asset

        visiting.add(relative_path)
        fd = _open_regular(source_path)
        with os.fdopen(fd, "rb") as source:
            raw = source.read(MAX_PLAYLIST_BYTES + 1)
        if len(raw) > MAX_PLAYLIST_BYTES:
            raise HlsIngestionError("HLS playlist exceeds the size limit.")
        try:
            playlist = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise HlsIngestionError("HLS playlist must be UTF-8.") from exc
        if not playlist.lstrip().startswith("#EXTM3U"):
            raise HlsIngestionError("Invalid HLS playlist header.")
        if re.search(r"(?im)^#EXT-X-SESSION-KEY:", playlist):
            raise HlsIngestionError("Encrypted or DRM HLS playlists are not ingested.")
        for key_line in (line.strip() for line in playlist.splitlines() if line.strip().upper().startswith("#EXT-X-KEY:")):
            attributes = key_line.split(":", 1)[1]
            method = re.search(r"(?:^|,)\s*METHOD=([^,]+)", attributes, re.IGNORECASE)
            if not method or method.group(1).strip().strip('"').upper() != "NONE" or re.search(r"(?:^|,)\s*URI=", attributes, re.IGNORECASE):
                raise HlsIngestionError("Encrypted or DRM HLS playlists are not ingested.")

        rewritten: list[str] = []
        member_ordinal = 0
        for line in playlist.splitlines():
            stripped = line.strip()
            if not stripped:
                rewritten.append(line)
                continue
            if stripped.startswith("#"):
                if "URI=" in line:
                    if not URI_ATTRIBUTE.search(line):
                        raise HlsIngestionError("HLS URI attributes must use the quoted RFC format.")
                    def replace_uri(match):
                        nonlocal member_ordinal
                        uri = _safe_relative_uri(match.group(1))
                        child_path = (PurePosixPath(relative_path).parent / uri).as_posix()
                        child = ingest_member(child_path, depth + 1)
                        child_role = "playlist" if uri.lower().endswith(".m3u8") else (
                            "initialization" if "EXT-X-MAP" in line else (
                                "subtitle" if "TYPE=SUBTITLES" in line else "segment"
                            )
                        )
                        edges.append((relative_path, child["asset_id"], uri, child_role, member_ordinal))
                        member_ordinal += 1
                        return f'URI="/api/dolby-vision/assets/{child["asset_id"]}/content"'
                    line = URI_ATTRIBUTE.sub(replace_uri, line)
                rewritten.append(line)
                continue
            uri = _safe_relative_uri(stripped)
            child = ingest_member((PurePosixPath(relative_path).parent / uri).as_posix(), depth + 1)
            edges.append((relative_path, child["asset_id"], uri, "playlist" if uri.lower().endswith(".m3u8") else "segment", member_ordinal))
            member_ordinal += 1
            rewritten.append(f'/api/dolby-vision/assets/{child["asset_id"]}/content')

        visiting.remove(relative_path)
        if len(edges) > MAX_GRAPH_EDGES:
            raise HlsIngestionError("HLS graph exceeds its edge limit.")
        manifest_bytes = ("\n".join(rewritten) + "\n").encode("utf-8")
        if total_graph_bytes + len(manifest_bytes) > MAX_GRAPH_TOTAL_BYTES:
            raise HlsIngestionError("HLS graph exceeds its aggregate media size limit.")
        total_graph_bytes += len(manifest_bytes)
        asset = _store_bytes(resource_id, manifest_bytes, "application/vnd.apple.mpegurl", object_dir)
        completed[relative_path] = asset
        return asset

    root_relative = playlist_path.relative_to(root).as_posix()
    root_asset = ingest_member(root_relative)
    with registry.connect() as connection:
        connection.execute(
            """INSERT OR IGNORE INTO registry_hls_asset_graphs
               (graph_id,resource_id,root_asset_id,created_at) VALUES(?,?,?,?)""",
            (root_asset["asset_id"], resource_id, root_asset["asset_id"], int(time.time())),
        )
        for parent_path, child_id, uri, role, ordinal in edges:
            parent_id = completed[parent_path]["asset_id"]
            existing = connection.execute(
                "SELECT child_asset_id,role,ordinal FROM registry_hls_asset_edges WHERE parent_asset_id=? AND relative_uri=?",
                (parent_id, uri),
            ).fetchone()
            if existing and (existing["child_asset_id"], existing["role"], existing["ordinal"]) != (child_id, role, ordinal):
                raise HlsIngestionError("Immutable HLS graph edge conflicts with an existing playlist.")
            connection.execute(
                """INSERT OR IGNORE INTO registry_hls_asset_edges
                   (parent_asset_id,child_asset_id,relative_uri,role,ordinal) VALUES(?,?,?,?,?)""",
                (parent_id, child_id, uri, role, ordinal),
            )
    return {
        "root_asset": root_asset,
        "member_count": len(completed),
        "edge_count": len(edges),
        "assets": completed,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest a trusted staged clear-HLS directory as an immutable asset graph.")
    parser.add_argument("--resource-id", required=True)
    parser.add_argument("--staging-dir", required=True)
    parser.add_argument("--playlist", required=True, help="Root playlist path, relative to staging-dir.")
    parser.add_argument("--object-root", default=os.environ.get("DV_MEDIA_OBJECT_ROOT", "/data/dv-media-objects"))
    args = parser.parse_args()
    result = ingest_hls_directory(args.resource_id, args.staging_dir, args.playlist, args.object_root)
    root = result["root_asset"]
    print(f"Registered HLS graph root={root['asset_id']} sha256={root['sha256']} members={result['member_count']} edges={result['edge_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
