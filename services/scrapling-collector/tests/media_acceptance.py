#!/usr/bin/env python3
"""Decode a previously downloaded 4K sample inside a no-network sandbox."""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="read-only local media file")
    parser.add_argument("--requested-seconds", type=int, default=60)
    args = parser.parse_args()
    media = Path(args.input)
    if not media.is_absolute() or not media.is_file() or media.is_symlink():
        raise SystemExit("Input must be an existing local regular file")
    if not 10 <= args.requested_seconds <= 300:
        raise SystemExit("requested-seconds must be between 10 and 300")

    probe = subprocess.run(
        [
            "ffprobe", "-protocol_whitelist", "file,pipe",
            "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name,width,height",
            "-show_entries", "format=duration",
            "-of", "json", str(media),
        ],
        check=True, capture_output=True, text=True, timeout=60,
    )
    metadata = json.loads(probe.stdout)
    streams = metadata.get("streams") or []
    if not streams:
        raise SystemExit("No video stream found in local media sample")
    video = streams[0]
    width = int(video.get("width") or 0)
    height = int(video.get("height") or 0)
    if width < 3840 or height < 2160:
        raise SystemExit(f"FAIL: expected UHD 4K, got {width}x{height}")
    duration = float((metadata.get("format") or {}).get("duration") or 0)
    if duration < args.requested_seconds * 0.9:
        raise SystemExit(f"FAIL: local sample is too short ({duration:.2f}s)")

    decoded = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-protocol_whitelist", "file,pipe", "-threads", "2",
            "-i", str(media), "-map", "0:v:0",
            "-progress", "pipe:1", "-nostats", "-f", "null", "-",
        ],
        check=True, capture_output=True, text=True,
        timeout=args.requested_seconds * 10 + 120,
    )
    frames = decoded_us = 0
    for line in decoded.stdout.splitlines():
        if line.startswith("frame="):
            try:
                frames = max(frames, int(line.split("=", 1)[1]))
            except ValueError:
                pass
        elif line.startswith("out_time_us="):
            try:
                decoded_us = max(decoded_us, int(line.split("=", 1)[1]))
            except ValueError:
                pass
        elif line.startswith("out_time_ms="):
            try:
                decoded_us = max(decoded_us, int(line.split("=", 1)[1]))
            except ValueError:
                pass

    decoded_seconds = decoded_us / 1_000_000
    if frames <= 0 or decoded_seconds < args.requested_seconds * 0.9:
        raise SystemExit(
            f"FAIL: decoded only {decoded_seconds:.2f}s and {frames} frames"
        )
    print(json.dumps({
        "status": "passed",
        "network": "disabled",
        "read_only_input": True,
        "codec": video.get("codec_name"),
        "width": width,
        "height": height,
        "requested_decode_seconds": args.requested_seconds,
        "decoded_frames": frames,
        "decoded_media_seconds": round(decoded_seconds, 2),
        "input_bytes": media.stat().st_size,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
