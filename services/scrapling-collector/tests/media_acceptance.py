#!/usr/bin/env python3
"""Opt-in real 4K decode and sustained playback acceptance.

Requires an operator-approved public HTTPS fixture, an explicit host allowlist,
ffmpeg/ffprobe, and the current-boot collector firewall proof. The URL is never
printed because test fixtures may contain sensitive query material.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse
import ipaddress


def require_firewall_proof():
    if os.environ.get("SCRAPLING_EGRESS_FIREWALL_CONFIRMED") != "1":
        raise SystemExit("FAIL: current-boot egress firewall gate is not enabled")
    marker_path = Path(os.environ.get("SCRAPLING_EGRESS_MARKER_PATH", "/run/libretv-scrapling-egress/confirmed.json"))
    try:
        marker = json.loads(marker_path.read_text())
        boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    except (OSError, ValueError) as exc:
        raise SystemExit("FAIL: current-boot firewall proof is missing") from exc
    if marker.get("policy_version") != 1 or marker.get("boot_id") != boot_id:
        raise SystemExit("FAIL: firewall proof is stale or invalid")


def main():
    url = os.environ.get("MEDIA_ACCEPTANCE_URL", "").strip()
    if not url:
        raise SystemExit("Set MEDIA_ACCEPTANCE_URL to an operator-approved public test stream")
    parsed = urlparse(url)
    allowed = {x.strip().lower() for x in os.environ.get("MEDIA_ACCEPTANCE_ALLOWED_HOSTS", "").split(",") if x.strip()}
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.hostname.lower() not in allowed:
        raise SystemExit("FAIL: media fixture must be HTTPS and its host explicitly allowlisted")
    try:
        addresses = {ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)}
    except OSError as exc:
        raise SystemExit("FAIL: media fixture host did not resolve") from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise SystemExit("FAIL: media fixture resolved to a private or reserved address")
    require_firewall_proof()

    protocol_whitelist = "https,tls,tcp,crypto,hls,pipe"
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-protocol_whitelist", protocol_whitelist,
        "-show_streams", "-show_format", "-of", "json", url,
    ], capture_output=True, text=True, timeout=90)
    if probe.returncode:
        raise SystemExit("FAIL: ffprobe could not inspect the approved media fixture")
    data = json.loads(probe.stdout)
    video = next((stream for stream in data.get("streams", []) if stream.get("codec_type") == "video"), None)
    if not video:
        raise SystemExit("FAIL: no video stream was decoded")
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    if width < 3840 or height < 2160:
        raise SystemExit(f"FAIL: decoded video dimensions are {width}x{height}, not UHD 4K")
    started = time.monotonic()
    requested_seconds = int(os.environ.get("MEDIA_ACCEPTANCE_SECONDS", "60"))
    decode = subprocess.run([
        "ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-v", "error",
        "-protocol_whitelist", protocol_whitelist, "-i", url,
        "-map", "0:v:0", "-t", str(requested_seconds),
        "-progress", "pipe:1", "-f", "null", "-",
    ], capture_output=True, text=True, timeout=max(240, requested_seconds * 4 + 60))
    elapsed = time.monotonic() - started
    if decode.returncode:
        raise SystemExit("FAIL: sustained native-resolution decode failed")
    progress = {}
    for line in decode.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            progress[key] = value
    decoded_us = int(progress.get("out_time_us") or progress.get("out_time_ms") or 0)
    frames = int(progress.get("frame") or 0)
    if frames < 1 or decoded_us < requested_seconds * 1_000_000 * 0.9:
        raise SystemExit("FAIL: stream ended before the required sustained decode interval")
    report = {
        "status": "passed", "width": width, "height": height,
        "codec": video.get("codec_name"), "pixel_format": video.get("pix_fmt"),
        "duration_seconds": round(elapsed, 2),
        "requested_decode_seconds": requested_seconds,\n        "decoded_frames": frames,\n        "decoded_media_seconds": round(decoded_us / 1_000_000, 2),
        "evidence": "ffprobe stream dimensions plus ffmpeg native-resolution frame decode",
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
