#!/usr/bin/env python3
"""Trusted local-file ingestion for Dolby Vision evidence.

This module deliberately has no HTTP client and accepts no URL. A separately
trusted gateway must stage the exact media bytes before invoking this worker.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import stat
import tempfile
from pathlib import Path
from typing import BinaryIO

import registry_queue as registry

MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "video/mp4",
    "video/webm",
}
RESOURCE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,200}$")


class IngestionError(RuntimeError):
    pass


def _hash_stream(source: BinaryIO, target: BinaryIO | None, max_bytes: int) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = source.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise IngestionError("Media exceeds the configured ingestion size limit.")
        digest.update(chunk)
        if target is not None:
            target.write(chunk)
    if total <= 0:
        raise IngestionError("Empty media files cannot be registered.")
    return digest.hexdigest(), total


def _open_regular_source(source_path: Path) -> int:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(source_path, flags)
    except OSError as exc:
        raise IngestionError("Cannot safely open staged media file.") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise IngestionError("Staged media must be a regular file.")
    except Exception:
        os.close(fd)
        raise
    return fd


def _verify_existing_object(object_path: Path, expected_digest: str, expected_length: int) -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(object_path, flags)
    except OSError as exc:
        raise IngestionError("Content-addressed object path exists but cannot be safely opened.") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size != expected_length:
            raise IngestionError("Existing content-addressed object metadata does not match.")
        with os.fdopen(fd, "rb", closefd=False) as source:
            digest, length = _hash_stream(source, None, MAX_MEDIA_BYTES)
        if digest != expected_digest or length != expected_length:
            raise IngestionError("Existing content-addressed object failed digest verification.")
    finally:
        os.close(fd)


def ingest_staged_file(
    resource_id: str,
    source_path: str | Path,
    object_root: str | Path,
    content_type: str,
    max_bytes: int = MAX_MEDIA_BYTES,
) -> dict:
    """Durably store exact staged bytes, then register their computed digest."""
    if not isinstance(resource_id, str) or not RESOURCE_ID_RE.fullmatch(resource_id):
        raise IngestionError("Invalid registry resource ID.")
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise IngestionError("Unsupported media content type.")
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or not 1 <= max_bytes <= MAX_MEDIA_BYTES:
        raise IngestionError("Invalid ingestion size limit.")

    # Only a resource that has independently passed public-access and player
    # verification may receive an immutable asset. The declared format must also
    # agree with the bytes' trusted ingestion MIME assertion.
    with registry.connect() as connection:
        resource = connection.execute(
            """SELECT resource_type,access_state,validation_state,playback_state,media_format
               FROM registry_resources WHERE id=?""",
            (resource_id,),
        ).fetchone()
    if not resource:
        raise IngestionError("Registry resource does not exist.")
    if (resource["resource_type"] != "DIRECT_MEDIA" or
            resource["access_state"] != "PUBLIC" or
            resource["validation_state"] != "validated" or
            resource["playback_state"] != "PLAYER_CONFIRMED"):
        raise IngestionError("Media ingestion requires a validated PUBLIC resource with confirmed playback.")
    expected_format = "webm" if content_type == "video/webm" else "mp4"
    if resource["media_format"] != expected_format:
        raise IngestionError("Media content type does not match the validated registry media format.")

    source_fd = _open_regular_source(Path(source_path))
    root = Path(object_root)
    root.mkdir(parents=True, exist_ok=True)
    try:
        with os.fdopen(source_fd, "rb", closefd=True) as source:
            # First pass hashes the staged input. No registry value is trusted from
            # the caller; the digest and length are always calculated here.
            digest, byte_length = _hash_stream(source, None, max_bytes)
            source.seek(0)

            relative_key = Path("sha256") / digest[:2] / digest
            destination_dir = root / relative_key.parent
            destination_dir.mkdir(parents=True, exist_ok=True)
            destination = root / relative_key

            if destination.exists() or destination.is_symlink():
                _verify_existing_object(destination, digest, byte_length)
            else:
                temp_fd, temp_name = tempfile.mkstemp(prefix=".dv-ingest-", dir=destination_dir)
                temp_path = Path(temp_name)
                try:
                    with os.fdopen(temp_fd, "wb", closefd=True) as target:
                        copied_digest, copied_length = _hash_stream(source, target, max_bytes)
                        target.flush()
                        os.fsync(target.fileno())
                    if copied_digest != digest or copied_length != byte_length:
                        raise IngestionError("Staged media changed while being ingested.")
                    try:
                        # Hard-link is atomic and fails rather than overwriting an
                        # existing object, preserving content-addressed immutability.
                        os.link(temp_path, destination, follow_symlinks=False)
                    except FileExistsError:
                        _verify_existing_object(destination, digest, byte_length)
                    directory_fd = os.open(destination_dir, os.O_RDONLY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
                finally:
                    try:
                        temp_path.unlink()
                    except FileNotFoundError:
                        pass

        # Registration occurs only after the durable object is present and verified.
        asset = registry.register_dolby_vision_media_asset(
            resource_id, digest, byte_length, content_type
        )
        if asset["object_key"] != relative_key.as_posix():
            raise IngestionError("Registry object key does not match the content digest.")
        return {
            "asset": asset,
            "stored_path": str(destination),
            "sha256": digest,
            "byte_length": byte_length,
            "content_type": content_type,
        }
    except OSError as exc:
        raise IngestionError("Media ingestion storage operation failed.") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest a trusted staged media file into the local DV object store.")
    parser.add_argument("--resource-id", required=True)
    parser.add_argument("--file", required=True, help="Path to a locally staged regular file; URLs are not accepted.")
    parser.add_argument("--content-type", required=True, choices=sorted(ALLOWED_CONTENT_TYPES))
    parser.add_argument("--object-root", default=os.environ.get("DV_MEDIA_OBJECT_ROOT", "/data/dv-media-objects"))
    parser.add_argument("--max-bytes", type=int, default=MAX_MEDIA_BYTES)
    args = parser.parse_args()
    result = ingest_staged_file(args.resource_id, args.file, args.object_root, args.content_type, args.max_bytes)
    print(f"Registered {result['asset']['asset_id']} sha256={result['sha256']} bytes={result['byte_length']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
