#!/usr/bin/env python3
"""Narrow, operator-authorized progressive-media source gateway.

The gateway only fetches the exact URL already stored for a validated,
PUBLIC, player-confirmed candidate. It requires an explicit exact-host
allowlist and an operator enable switch. Redirects, cookies, credentials,
arbitrary request headers, HLS/DASH manifests, and DRM are not supported.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import ssl
import tempfile
import threading
import time

from fastapi import HTTPException
from pathlib import Path
from urllib.parse import urlparse

import registry_queue as registry
from dv_media_ingest import IngestionError, ingest_staged_file

CHUNK_SIZE = 1024 * 1024
DEFAULT_MAX_BYTES = 512 * 1024 * 1024
MAX_ALLOWED_BYTES = 2 * 1024 * 1024 * 1024
_slots = threading.BoundedSemaphore(1)


class SourceGatewayError(RuntimeError):
    pass


def _positive_limit(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default)).strip()
    if not raw.isdigit():
        raise SourceGatewayError(f"{name} must be an integer in the supported range")
    value = int(raw)
    if not minimum <= value <= maximum:
        raise SourceGatewayError(f"{name} is outside the supported range")
    return value


def _authorized_hosts() -> set[str]:
    raw = os.environ.get("DV_AUTHORIZED_SOURCE_HOSTS", "")
    hosts: set[str] = set()
    for item in raw.split(","):
        host = item.strip().lower().rstrip(".")
        if not host:
            continue
        if (len(host) > 253 or "*" in host or "/" in host or ":" in host
                or not re.fullmatch(r"[a-z0-9.-]+", host)
                or host.startswith(".") or host.endswith(".") or ".." in host):
            raise SourceGatewayError("DV_AUTHORIZED_SOURCE_HOSTS contains an invalid exact hostname")
        hosts.add(host)
    return hosts


def gateway_enabled() -> bool:
    return os.environ.get("DV_SOURCE_GATEWAY_ENABLED", "").strip() == "1"


def is_source_host_authorized(host: str | None) -> bool:
    if not isinstance(host, str):
        return False
    try:
        return host.strip().lower().rstrip(".") in _authorized_hosts()
    except SourceGatewayError:
        return False


def _json_object(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _read_candidate(candidate_id: str) -> dict:
    with registry.connect() as connection:
        row = connection.execute(
            "SELECT id,url,host,kind,status,access_state,validation,playback_verification "
            "FROM candidates WHERE id=?",
            (candidate_id,),
        ).fetchone()
    if not row:
        raise SourceGatewayError("Candidate not found")
    return dict(row)


def _verify_registry_gate(resource_id: str, expected_format: str) -> None:
    with registry.connect() as connection:
        row = connection.execute(
            "SELECT resource_type,access_state,validation_state,playback_state,media_format "
            "FROM registry_resources WHERE id=?",
            (resource_id,),
        ).fetchone()
    if not row:
        raise SourceGatewayError("Registry resource not found")
    if (row["resource_type"] != "DIRECT_MEDIA" or row["access_state"] != "PUBLIC"
            or row["validation_state"] != "validated"
            or row["playback_state"] != "PLAYER_CONFIRMED"
            or row["media_format"] != expected_format):
        raise SourceGatewayError("Registry resource has not passed the ingestion eligibility gate")


def ingest_authorized_candidate(
    candidate_id: str,
    resource_id: str,
    *,
    public_https_url,
    resolve_public_addresses,
    pinned_connection_cls,
    cancelled=lambda: False,
    checkpoint=lambda _value: None,
) -> dict:
    """Fetch one approved MP4/WebM source and register the exact received bytes.

    No caller-supplied URL is accepted. The URL is read from the collector's
    persisted candidate row and must match its validated hostname exactly.
    """
    if not gateway_enabled():
        return {"status": "skipped", "reason": "source_gateway_disabled"}
    if os.environ.get("SCRAPLING_EGRESS_FIREWALL_CONFIRMED", "").strip() != "1":
        return {"status": "skipped", "reason": "egress_firewall_not_confirmed"}

    try:
        hosts = _authorized_hosts()
        candidate = _read_candidate(candidate_id)
        validation = _json_object(candidate.get("validation"))
        playback = _json_object(candidate.get("playback_verification"))
        if (candidate.get("kind") != "direct-media" or candidate.get("status") != "validated"
                or candidate.get("access_state") != "PUBLIC"):
            raise SourceGatewayError("Candidate is not a validated PUBLIC direct-media source")
        if validation.get("reachable") is not True:
            raise SourceGatewayError("Candidate preflight is not successful")
        access = _json_object(validation.get("access"))
        if access.get("access_state") != "PUBLIC":
            raise SourceGatewayError("Candidate preflight does not confirm PUBLIC access")
        if playback.get("state") != "PLAYER_CONFIRMED" or float(playback.get("progressed_seconds") or 0) < 2:
            raise SourceGatewayError("Browser playback confirmation is missing")
        media_format = validation.get("media_format")
        media_type = playback.get("media_type")
        if media_format == "hls":
            return {"status": "skipped", "reason": "hls_requires_immutable_graph_ingestion"}
        if media_format != "progressive" or media_type not in {"mp4", "webm"}:
            raise SourceGatewayError("Only confirmed progressive MP4/WebM media is supported")
        content_type = str(validation.get("content_type") or "").split(";", 1)[0].strip().lower()
        expected_type = "video/webm" if media_type == "webm" else "video/mp4"
        if content_type != expected_type:
            raise SourceGatewayError("Validated MIME type does not match the confirmed media format")
        _verify_registry_gate(resource_id, media_type)

        raw_url = candidate.get("url")
        normalized, host = public_https_url(raw_url)
        candidate_host = str(candidate.get("host") or "").lower().rstrip(".")
        parsed = urlparse(normalized)
        if (host != candidate_host or parsed.hostname != host or host not in hosts
                or parsed.username or parsed.password or parsed.port not in (None, 443)):
            return {"status": "skipped", "reason": "source_host_not_explicitly_authorized"}
        validated_final = str(validation.get("final_url") or normalized)
        final_parsed = urlparse(validated_final)
        if (final_parsed.scheme != "https" or (final_parsed.hostname or "").lower().rstrip(".") != host
                or final_parsed.username or final_parsed.password or final_parsed.port not in (None, 443)):
            raise SourceGatewayError("Validated media URL changed host or scheme")
        if validated_final != normalized:
            # Redirects are intentionally not replayed by the gateway. Operators
            # must register the final same-host URL as the candidate source.
            return {"status": "skipped", "reason": "redirected_source_requires_explicit_final_url"}

        maximum = _positive_limit("DV_SOURCE_GATEWAY_MAX_BYTES", DEFAULT_MAX_BYTES, 1024, MAX_ALLOWED_BYTES)
        timeout = _positive_limit("DV_SOURCE_GATEWAY_TIMEOUT_SECONDS", 15, 5, 60)
        pinned_ip = resolve_public_addresses(host)[0]
        target = parsed.path or "/"
        if parsed.query:
            target += "?" + parsed.query

        if not _slots.acquire(blocking=False):
            return {"status": "skipped", "reason": "source_gateway_busy"}
        connection = None
        response = None
        temporary_path = None
        try:
            connection = pinned_connection_cls(
                host, pinned_ip, 443, timeout=timeout, context=ssl.create_default_context()
            )
            connection.request("GET", target, headers={
                "Accept": expected_type,
                "Accept-Encoding": "identity",
                "User-Agent": "LibreTV-Authorized-Media-Gateway/1.0",
                "Connection": "close",
            })
            response = connection.getresponse()
            headers = {key.lower(): value for key, value in response.getheaders()}
            if response.status != 200:
                raise SourceGatewayError("Origin did not return HTTP 200; redirects and partial responses are rejected")
            received_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if received_type != expected_type:
                raise SourceGatewayError("Origin Content-Type differs from the validated media type")
            if headers.get("content-encoding", "identity").lower() not in ("", "identity"):
                raise SourceGatewayError("Compressed origin responses are not accepted")
            raw_length = headers.get("content-length", "")
            if not raw_length.isdigit() or len(raw_length) > 10:
                raise SourceGatewayError("Origin must provide an exact Content-Length")
            expected_length = int(raw_length)
            if expected_length <= 0 or expected_length > maximum:
                raise SourceGatewayError("Origin media length exceeds the configured gateway limit")

            staging_root = registry.DV_MEDIA_STAGING_ROOT
            staging_root.mkdir(parents=True, exist_ok=True)
            suffix = ".webm" if expected_type == "video/webm" else ".mp4"
            descriptor, name = tempfile.mkstemp(prefix="dv-authorized-", suffix=suffix, dir=staging_root)
            temporary_path = Path(name)
            digest = hashlib.sha256()
            received = 0
            deadline = time.monotonic() + max(60, timeout * 20)
            with os.fdopen(descriptor, "wb", closefd=True) as target_file:
                last_checkpoint = 0
                while received < expected_length:
                    if cancelled():
                        raise registry.JobCancelled()
                    if time.monotonic() > deadline:
                        raise SourceGatewayError("Origin transfer exceeded the total transfer deadline")
                    chunk = response.read(min(CHUNK_SIZE, expected_length - received))
                    if not chunk:
                        raise SourceGatewayError("Origin closed before the declared media length was received")
                    received += len(chunk)
                    if received > maximum or received > expected_length:
                        raise SourceGatewayError("Origin exceeded the declared media length")
                    digest.update(chunk)
                    target_file.write(chunk)
                    if received - last_checkpoint >= 8 * CHUNK_SIZE:
                        checkpoint({"stage": "authorized_media_download", "bytes_received": received, "total_bytes": expected_length})
                        last_checkpoint = received
                target_file.flush()
                os.fsync(target_file.fileno())
            if cancelled():
                raise registry.JobCancelled()
            if response.read(1):
                raise SourceGatewayError("Origin sent bytes beyond the declared Content-Length")
            checkpoint({"stage": "authorized_media_storing", "bytes_received": received, "total_bytes": expected_length})

            result = ingest_staged_file(
                resource_id, temporary_path, registry.DV_MEDIA_OBJECT_ROOT,
                expected_type, maximum,
            )
            if result["sha256"] != digest.hexdigest() or result["byte_length"] != received:
                raise SourceGatewayError("Stored object digest differs from the bytes received from the authorized origin")
            return {
                "status": "registered",
                "asset": result["asset"],
                "sha256": digest.hexdigest(),
                "byte_length": received,
                "content_type": expected_type,
                "source_host": host,
            }
        finally:
            try:
                if response is not None:
                    response.close()
            finally:
                try:
                    if connection is not None:
                        connection.close()
                finally:
                    try:
                        if temporary_path is not None:
                            try:
                                temporary_path.unlink()
                            except FileNotFoundError:
                                pass
                    finally:
                        _slots.release()
    except (SourceGatewayError, IngestionError, HTTPException, OSError, ValueError, http.client.HTTPException, ssl.SSLError) as exc:
        return {"status": "failed", "reason": str(exc)[:240], "error_type": type(exc).__name__}
