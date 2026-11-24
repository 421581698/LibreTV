"""Authorized graph-aware HLS source acquisition.

Only exact allowlisted HTTPS hosts are fetched. Redirects, encryption keys,
DRM, arbitrary caller URLs, cookies and origin credentials are not supported.
"""
from __future__ import annotations

import hashlib
import http.client
import os
import re
import ssl
import tempfile
import time
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urljoin, urlsplit

from fastapi import HTTPException

import registry_queue as registry
from dv_hls_ingest import (
    CONTENT_TYPES,
    HlsIngestionError,
    MAX_GRAPH_MEMBERS,
    MAX_GRAPH_TOTAL_BYTES,
    MAX_PLAYLIST_BYTES,
    MAX_PLAYLIST_DEPTH,
    ingest_hls_directory,
)

MAX_MEMBER_BYTES = 2 * 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
URI_ATTRIBUTE = re.compile(r'URI="([^"]+)"')
ALLOWED_CONTENT_TYPES = {
    ".m3u8": {"application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "application/octet-stream"},
    ".ts": {"video/mp2t", "application/octet-stream"},
    ".m4s": {"video/iso.segment", "video/mp4", "application/octet-stream"},
    ".mp4": {"video/mp4", "application/octet-stream"},
    ".m4a": {"audio/mp4", "audio/m4a", "application/octet-stream"},
    ".aac": {"audio/aac", "audio/x-aac", "application/octet-stream"},
    ".mp3": {"audio/mpeg", "audio/mp3", "application/octet-stream"},
    ".vtt": {"text/vtt", "application/octet-stream"},
}


class HlsSourceGatewayError(RuntimeError):
    pass


def _safe_origin_url(raw_url: str, *, public_https_url, resolve_public_addresses, allowed_hosts: set[str]):
    normalized, host = public_https_url(raw_url)
    parsed = urlsplit(normalized)
    decoded_path = unquote(parsed.path)
    unsafe_path = "\\" in decoded_path or "\x00" in decoded_path or ".." in PurePosixPath(decoded_path).parts
    if (parsed.scheme != "https" or not parsed.hostname or parsed.hostname.lower().rstrip(".") != host
            or parsed.username or parsed.password or parsed.port not in (None, 443)
            or host not in allowed_hosts or parsed.fragment or unsafe_path):
        raise HlsSourceGatewayError("HLS member is outside the exact HTTPS source-host allowlist")
    addresses = resolve_public_addresses(host)
    if not addresses:
        raise HlsSourceGatewayError("HLS source hostname has no validated public address")
    return normalized, host, addresses[0]


def _resolve_member_url(base_url: str, raw_reference: str) -> str:
    if not isinstance(raw_reference, str) or not raw_reference or len(raw_reference) > 4096:
        raise HlsSourceGatewayError("Invalid HLS member reference")
    parsed = urlsplit(raw_reference)
    decoded_path = unquote(parsed.path)
    if ("\\" in decoded_path or "\x00" in decoded_path
            or any(part in {".", ".."} for part in PurePosixPath(decoded_path).parts)):
        raise HlsSourceGatewayError("HLS member path traversal is not allowed")
    return urljoin(base_url, raw_reference)


def _member_suffix(url: str) -> str:
    suffix = PurePosixPath(urlsplit(url).path).suffix.lower()
    if suffix not in CONTENT_TYPES:
        raise HlsSourceGatewayError("HLS member uses an unsupported file extension")
    return suffix


def _fetch_member(
    url: str,
    destination: Path,
    *,
    expected_suffix: str,
    public_https_url,
    resolve_public_addresses,
    pinned_connection_cls,
    max_bytes: int,
    timeout: int,
    cancelled,
    checkpoint,
    progress: dict,
) -> tuple[str, int]:
    normalized, host, pinned_ip = _safe_origin_url(
        url, public_https_url=public_https_url,
        resolve_public_addresses=resolve_public_addresses,
        allowed_hosts=progress["allowed_hosts"],
    )
    parsed = urlsplit(normalized)
    target = parsed.path or "/"
    if parsed.query:
        target += "?" + parsed.query
    connection = None
    response = None
    try:
        connection = pinned_connection_cls(
            host, pinned_ip, 443, timeout=timeout, context=ssl.create_default_context()
        )
        connection.request("GET", target, headers={
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "User-Agent": "LibreTV-Authorized-HLS-Gateway/1.0",
            "Connection": "close",
        })
        response = connection.getresponse()
        headers = {}
        for key, value in response.getheaders():
            name = key.lower()
            if name in {"content-type", "content-length", "content-encoding", "transfer-encoding"} and name in headers:
                raise HlsSourceGatewayError("HLS origin returned duplicate framing or media headers")
            headers[name] = value
        if "transfer-encoding" in headers or "content-range" in headers:
            raise HlsSourceGatewayError("Chunked and partial HLS origin responses are not accepted")
        if response.status != 200:
            raise HlsSourceGatewayError("HLS origin must return HTTP 200; redirects and partial responses are rejected")
        content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type not in ALLOWED_CONTENT_TYPES[expected_suffix]:
            raise HlsSourceGatewayError("HLS origin Content-Type does not match the member type")
        if headers.get("content-encoding", "identity").lower() not in ("", "identity"):
            raise HlsSourceGatewayError("Compressed HLS origin responses are not accepted")
        raw_length = headers.get("content-length", "")
        if not raw_length.isdigit() or len(raw_length) > 10:
            raise HlsSourceGatewayError("HLS origin must provide an exact Content-Length")
        expected_length = int(raw_length)
        if expected_length <= 0 or expected_length > max_bytes:
            raise HlsSourceGatewayError("HLS member exceeds its configured byte limit")
        if progress["total_bytes"] + expected_length > MAX_GRAPH_TOTAL_BYTES:
            raise HlsSourceGatewayError("HLS graph exceeds the aggregate byte limit before download")

        digest = hashlib.sha256()
        received = 0
        last_checkpoint = 0
        with destination.open("xb") as target_file:
            while received < expected_length:
                if cancelled():
                    raise registry.JobCancelled()
                if time.monotonic() > progress["deadline"]:
                    raise HlsSourceGatewayError("HLS graph transfer exceeded its total deadline")
                chunk = response.read(min(CHUNK_SIZE, expected_length - received))
                if not chunk:
                    raise HlsSourceGatewayError("HLS origin closed before Content-Length bytes were received")
                received += len(chunk)
                if received > expected_length or received > max_bytes:
                    raise HlsSourceGatewayError("HLS origin exceeded the declared member length")
                digest.update(chunk)
                target_file.write(chunk)
                if received - last_checkpoint >= 8 * CHUNK_SIZE:
                    checkpoint({
                        "stage": "authorized_hls_member_download",
                        "members_downloaded": progress["members_downloaded"],
                        "bytes_received": progress["total_bytes"] + received,
                        "member_bytes_received": received,
                        "member_bytes_total": expected_length,
                    })
                    last_checkpoint = received
            target_file.flush()
            os.fsync(target_file.fileno())
        if response.read(1):
            raise HlsSourceGatewayError("HLS origin sent bytes beyond Content-Length")
        progress["total_bytes"] += received
        if progress["total_bytes"] > MAX_GRAPH_TOTAL_BYTES:
            raise HlsSourceGatewayError("HLS graph exceeds the aggregate byte limit")
        checkpoint({
            "stage": "authorized_hls_member_download",
            "members_downloaded": progress["members_downloaded"] + 1,
            "bytes_received": progress["total_bytes"],
        })
        return digest.hexdigest(), received
    finally:
        try:
            if response is not None:
                response.close()
        finally:
            if connection is not None:
                connection.close()


def ingest_authorized_hls_candidate(
    candidate_id: str,
    resource_id: str,
    *,
    public_https_url,
    resolve_public_addresses,
    pinned_connection_cls,
    cancelled=lambda: False,
    checkpoint=lambda _value: None,
) -> dict:
    if os.environ.get("DV_SOURCE_GATEWAY_ENABLED", "").strip() != "1":
        return {"status": "skipped", "reason": "source_gateway_disabled"}
    if os.environ.get("SCRAPLING_EGRESS_FIREWALL_CONFIRMED", "").strip() != "1":
        return {"status": "skipped", "reason": "egress_firewall_not_confirmed"}

    staging = None
    try:
        from dv_source_gateway import _authorized_hosts, _json_object, _read_candidate, _verify_registry_gate, _positive_limit

        allowed_hosts = _authorized_hosts()
        candidate = _read_candidate(candidate_id)
        validation = _json_object(candidate.get("validation"))
        playback = _json_object(candidate.get("playback_verification"))
        if (candidate.get("kind") != "direct-media" or candidate.get("status") != "validated"
                or candidate.get("access_state") != "PUBLIC"
                or validation.get("reachable") is not True
                or _json_object(validation.get("access")).get("access_state") != "PUBLIC"):
            raise HlsSourceGatewayError("Candidate is not a validated PUBLIC direct-media HLS source")
        if playback.get("state") != "PLAYER_CONFIRMED" or playback.get("media_type") != "hls":
            raise HlsSourceGatewayError("Browser HLS playback confirmation is missing")
        if validation.get("media_format") != "hls":
            raise HlsSourceGatewayError("Candidate preflight did not identify HLS")
        _verify_registry_gate(resource_id, "hls")

        root_url, root_host, _ = _safe_origin_url(
            candidate.get("url") or "",
            public_https_url=public_https_url,
            resolve_public_addresses=resolve_public_addresses,
            allowed_hosts=allowed_hosts,
        )
        if root_host != str(candidate.get("host") or "").lower().rstrip("."):
            raise HlsSourceGatewayError("Persisted candidate hostname does not match its source URL")
        validated_final = str(validation.get("final_url") or root_url)
        final_url, final_host, _ = _safe_origin_url(
            validated_final,
            public_https_url=public_https_url,
            resolve_public_addresses=resolve_public_addresses,
            allowed_hosts=allowed_hosts,
        )
        if final_url != root_url or final_host != root_host:
            return {"status": "skipped", "reason": "redirected_source_requires_explicit_final_url"}

        max_member = _positive_limit("DV_SOURCE_GATEWAY_MAX_BYTES", 512 * 1024 * 1024, 1024, MAX_MEMBER_BYTES)
        timeout = _positive_limit("DV_SOURCE_GATEWAY_TIMEOUT_SECONDS", 15, 5, 60)
        staging_root = registry.DV_MEDIA_STAGING_ROOT
        staging_root.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix="dv-authorized-hls-", dir=staging_root))
        progress = {
            "allowed_hosts": allowed_hosts,
            "members_downloaded": 0,
            "allocated_members": 0,
            "total_bytes": 0,
            "deadline": time.monotonic() + 1800,
        }
        fetched: dict[str, Path] = {}
        visiting: set[str] = set()
        expected_media_digests: dict[str, tuple[str, int]] = {}

        def local_name(ordinal: int, suffix: str) -> str:
            return f"member-{ordinal:05d}{suffix}"

        def fetch_graph(member_url: str, depth: int = 0) -> str:
            if cancelled():
                raise registry.JobCancelled()
            if depth > MAX_PLAYLIST_DEPTH:
                raise HlsSourceGatewayError("HLS graph exceeds its nesting limit")
            normalized, _, _ = _safe_origin_url(
                member_url,
                public_https_url=public_https_url,
                resolve_public_addresses=resolve_public_addresses,
                allowed_hosts=allowed_hosts,
            )
            if normalized in fetched:
                return fetched[normalized].name
            if normalized in visiting:
                raise HlsSourceGatewayError("Cyclic HLS playlist references are not supported")
            if progress["allocated_members"] >= MAX_GRAPH_MEMBERS:
                raise HlsSourceGatewayError("HLS graph exceeds its member limit")
            suffix = _member_suffix(normalized)
            ordinal = progress["allocated_members"]
            progress["allocated_members"] += 1
            if suffix != ".m3u8":
                name = local_name(ordinal, suffix)
                path = staging / name
                member_digest, member_length = _fetch_member(
                    normalized, path, expected_suffix=suffix,
                    public_https_url=public_https_url,
                    resolve_public_addresses=resolve_public_addresses,
                    pinned_connection_cls=pinned_connection_cls,
                    max_bytes=max_member, timeout=timeout,
                    cancelled=cancelled, checkpoint=checkpoint, progress=progress,
                )
                expected_media_digests[name] = (member_digest, member_length)
                fetched[normalized] = path
                progress["members_downloaded"] += 1
                return name

            visiting.add(normalized)
            name = local_name(ordinal, ".m3u8")
            path = staging / name
            _fetch_member(
                normalized, path, expected_suffix=suffix,
                public_https_url=public_https_url,
                resolve_public_addresses=resolve_public_addresses,
                pinned_connection_cls=pinned_connection_cls,
                max_bytes=min(max_member, MAX_PLAYLIST_BYTES),
                timeout=timeout, cancelled=cancelled,
                checkpoint=checkpoint, progress=progress,
            )
            raw = path.read_bytes()
            if len(raw) > MAX_PLAYLIST_BYTES:
                raise HlsSourceGatewayError("HLS playlist exceeds its size limit")
            try:
                playlist = raw.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise HlsSourceGatewayError("HLS playlist must be UTF-8") from exc
            if not playlist.lstrip().startswith("#EXTM3U"):
                raise HlsSourceGatewayError("Invalid HLS playlist header")
            upper_playlist = playlist.upper()
            if "#EXTINF:" in upper_playlist and "#EXT-X-ENDLIST" not in upper_playlist:
                raise HlsSourceGatewayError("Only finalized HLS VOD/event playlists can be frozen into an immutable graph")
            if re.search(r"(?im)^#EXT-X-SESSION-KEY:", playlist):
                raise HlsSourceGatewayError("Encrypted or DRM HLS playlists are not fetched")
            rewritten = []
            for line in playlist.splitlines():
                stripped = line.strip()
                if not stripped:
                    rewritten.append(line)
                    continue
                if stripped.startswith("#"):
                    if stripped.upper().startswith("#EXT-X-KEY:"):
                        attrs = stripped.split(":", 1)[1]
                        method = re.search(r"(?:^|,)\s*METHOD=([^,]+)", attrs, re.IGNORECASE)
                        if (not method or method.group(1).strip().strip('"').upper() != "NONE"
                                or re.search(r"(?:^|,)\s*URI=", attrs, re.IGNORECASE)):
                            raise HlsSourceGatewayError("Encrypted or DRM HLS playlists are not fetched")
                    if re.search(r"\bURI\s*=", line, re.IGNORECASE):
                        matches = list(URI_ATTRIBUTE.finditer(line))
                        uri_attribute_count = len(re.findall(r"\bURI\s*=", line, re.IGNORECASE))
                        if not matches or len(matches) != uri_attribute_count:
                            raise HlsSourceGatewayError("HLS URI attributes must use the exact quoted RFC format")
                        for match in reversed(matches):
                            absolute = _resolve_member_url(normalized, match.group(1))
                            child_name = fetch_graph(absolute, depth + 1)
                            line = line[:match.start(1)] + child_name + line[match.end(1):]
                    rewritten.append(line)
                    continue
                absolute = _resolve_member_url(normalized, stripped)
                rewritten.append(fetch_graph(absolute, depth + 1))
            path.write_text("\n".join(rewritten) + "\n", encoding="utf-8")
            visiting.remove(normalized)
            fetched[normalized] = path
            progress["members_downloaded"] += 1
            return name

        root_name = fetch_graph(root_url)
        if cancelled():
            raise registry.JobCancelled()
        # Verify every downloaded media member still matches its network-transfer
        # digest before the local graph ingester computes and registers its own hash.
        for relative_name, (expected_digest, expected_length) in expected_media_digests.items():
            digest_builder = hashlib.sha256()
            observed_length = 0
            with (staging / relative_name).open("rb") as source:
                for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
                    observed_length += len(chunk)
                    digest_builder.update(chunk)
            if observed_length != expected_length or digest_builder.hexdigest() != expected_digest:
                raise HlsSourceGatewayError("Staged HLS media member differs from the authorized origin transfer")
        checkpoint({
            "stage": "authorized_hls_graph_storing",
            "members_downloaded": progress["members_downloaded"],
            "bytes_received": progress["total_bytes"],
        })
        graph = ingest_hls_directory(
            resource_id, staging, staging / root_name, registry.DV_MEDIA_OBJECT_ROOT
        )
        return {
            "status": "registered",
            "root_asset": graph["root_asset"],
            "member_count": graph["member_count"],
            "edge_count": graph["edge_count"],
            "byte_length": progress["total_bytes"],
            "source_host": root_host,
        }
    except (HlsSourceGatewayError, HlsIngestionError, HTTPException, OSError, ValueError, http.client.HTTPException, ssl.SSLError) as exc:
        return {"status": "failed", "reason": str(exc)[:240], "error_type": type(exc).__name__}
    finally:
        if staging is not None:
            import shutil
            shutil.rmtree(staging, ignore_errors=True)
