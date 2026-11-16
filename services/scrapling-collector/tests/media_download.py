#!/usr/bin/env python3
"""Download a bounded public MP4/WebM sample before isolated media decoding.

This stage is networked and must run only in the Collector container after the
current-boot egress firewall proof is installed. The resulting local file is
then passed to a separate no-network, read-only FFprobe/FFmpeg sandbox.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, "/app")
from app import public_https_url, require_egress_firewall


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="/tmp/media-acceptance-sample.mkv")
    args = parser.parse_args()

    raw_url = os.environ.get("MEDIA_ACCEPTANCE_URL", "").strip()
    allowed = {
        value.strip().lower().rstrip(".")
        for value in os.environ.get("MEDIA_ACCEPTANCE_ALLOWED_HOSTS", "").split(",")
        if value.strip()
    }
    try:
        seconds = int(os.environ.get("MEDIA_ACCEPTANCE_SECONDS", "60"))
    except ValueError as exc:
        raise SystemExit("MEDIA_ACCEPTANCE_SECONDS must be an integer") from exc
    if not 10 <= seconds <= 300:
        raise SystemExit("MEDIA_ACCEPTANCE_SECONDS must be between 10 and 300")
    if not raw_url:
        raise SystemExit("MEDIA_ACCEPTANCE_URL is required")

    normalized, host = public_https_url(raw_url)
    if host not in allowed:
        raise SystemExit("Media fixture host is not in MEDIA_ACCEPTANCE_ALLOWED_HOSTS")
    suffix = Path(urlsplit(normalized).path).suffix.lower()
    if suffix not in {".mp4", ".m4v", ".webm"}:
        raise SystemExit("Media acceptance requires a direct MP4, M4V or WebM URL (no HLS/DRM playlists)")
    require_egress_firewall()

    # Refuse redirects so the fetch cannot silently leave the operator's
    # explicit hostname allowlist.
    request = urllib.request.Request(
        normalized,
        headers={
            "Range": "bytes=0-0",
            "User-Agent": "LibreTV-Collector-Acceptance/1.0 (CI media validation)",
            "Accept": "video/webm,video/mp4,application/octet-stream;q=0.9,*/*;q=0.8",
        },
        method="GET",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)
    try:
        with opener.open(request, timeout=20) as response:
            if response.status not in {200, 206} or response.geturl() != normalized:
                raise SystemExit("Media fixture must respond directly without redirects")
            content_type = (response.headers.get("Content-Type") or "").lower()
            if "mpegurl" in content_type or "dash+xml" in content_type:
                raise SystemExit("HLS/DASH playlists are not accepted by this direct-file harness")
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Media fixture redirect or HTTP error rejected: {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise SystemExit(f"Media fixture preflight failed: {exc}") from exc

    output = Path(args.output)
    if not output.is_absolute() or output.parent != Path("/tmp"):
        raise SystemExit("Output must be a direct child of /tmp")
    output.unlink(missing_ok=True)

    command = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-rw_timeout", "30000000",
        "-protocol_whitelist", "https,tls,tcp",
        "-user_agent", "LibreTV-Collector-Acceptance/1.0 (CI media validation)",
        "-i", normalized,
        "-map", "0:v:0", "-t", str(seconds),
        "-c:v", "copy", "-an", "-sn", "-dn",
        "-f", "matroska", "-y", str(output),
    ]
    env = os.environ.copy()
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env.pop(key, None)
    try:
        subprocess.run(command, check=True, timeout=seconds * 10 + 120, env=env)
    except subprocess.TimeoutExpired as exc:
        raise SystemExit("Timed out downloading the bounded media fixture") from exc
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"FFmpeg fixture download failed with exit code {exc.returncode}") from exc

    size = output.stat().st_size if output.exists() else 0
    if size < 1024 * 1024:
        raise SystemExit("Downloaded media fixture is unexpectedly small")
    print({
        "status": "downloaded",
        "host": host,
        "requested_seconds": seconds,
        "file_bytes": size,
        "output": str(output),
    })


if __name__ == "__main__":
    main()
