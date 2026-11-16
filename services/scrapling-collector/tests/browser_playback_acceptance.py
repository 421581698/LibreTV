#!/usr/bin/env python3
"""Real browser video-element 4K decode and continuous playback acceptance."""
from __future__ import annotations

import json
import os
import socket
import time
from pathlib import Path
from urllib.parse import urlparse
import ipaddress


def main():
    url = os.environ.get("MEDIA_ACCEPTANCE_URL", "").strip()
    allowed = {x.strip().lower() for x in os.environ.get("MEDIA_ACCEPTANCE_ALLOWED_HOSTS", "").split(",") if x.strip()}
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.hostname.lower() not in allowed:
        raise SystemExit("FAIL: browser media fixture must be an allowlisted HTTPS URL")
    if not parsed.path.lower().endswith((".mp4", ".m4v", ".webm")):
        raise SystemExit("FAIL: Chromium acceptance requires a direct MP4 or WebM fixture (HLS is tested by ffmpeg)")
    try:
        addresses = {ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)}
    except OSError as exc:
        raise SystemExit("FAIL: media fixture host did not resolve") from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise SystemExit("FAIL: media fixture resolved to a private or reserved address")
    if os.environ.get("SCRAPLING_EGRESS_FIREWALL_CONFIRMED") != "1":
        raise SystemExit("FAIL: current-boot egress firewall gate is disabled")
    marker_path = Path(os.environ.get("SCRAPLING_EGRESS_MARKER_PATH", "/run/libretv-scrapling-egress/confirmed.json"))
    try:
        marker = json.loads(marker_path.read_text())
        boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    except (OSError, ValueError) as exc:
        raise SystemExit("FAIL: current-boot firewall proof is missing") from exc
    if marker.get("policy_version") != 1 or marker.get("boot_id") != boot_id:
        raise SystemExit("FAIL: firewall proof is stale or invalid")

    from playwright.sync_api import sync_playwright

    duration = int(os.environ.get("MEDIA_ACCEPTANCE_SECONDS", "60"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content('<video id="acceptance-video" muted autoplay playsinline controls></video>')
        page.locator("#acceptance-video").evaluate("(video, url) => { video.src = url; video.load(); }", url)
        page.wait_for_function(
            "() => { const v=document.querySelector('#acceptance-video'); return v && v.readyState >= 2 && v.videoWidth > 0; }",
            timeout=90000,
        )
        dimensions = page.locator("#acceptance-video").evaluate(
            "v => ({width:v.videoWidth,height:v.videoHeight,codec:v.currentSrc})"
        )
        if dimensions["width"] < 3840 or dimensions["height"] < 2160:
            browser.close()
            raise SystemExit("FAIL: browser decoded video below UHD 4K dimensions")
        page.locator("#acceptance-video").evaluate("v => v.play()")
        start = time.monotonic()
        start_time = page.locator("#acceptance-video").evaluate("v => v.currentTime")
        last_time = start_time
        last_progress = time.monotonic()
        stalls = 0
        while time.monotonic() - start < duration:
            page.wait_for_timeout(1000)
            state = page.locator("#acceptance-video").evaluate(
                "v => ({time:v.currentTime,paused:v.paused,ended:v.ended,frames:(v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : 0),ready:v.readyState})"
            )
            if state["time"] > last_time + 0.05:
                last_time = state["time"]
                last_progress = time.monotonic()
            elif time.monotonic() - last_progress > 5:
                stalls += 1
                last_progress = time.monotonic()
            if state["ended"]:
                break
        final = page.locator("#acceptance-video").evaluate(
            "v => ({time:v.currentTime,frames:(v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : 0),width:v.videoWidth,height:v.videoHeight,ended:v.ended})"
        )
        browser.close()

    progressed = final["time"] - start_time
    if progressed < duration * 0.9 or final["frames"] < 1 or stalls > 2:
        raise SystemExit("FAIL: browser playback did not sustain the required 4K time progression")
    print(json.dumps({
        "status": "passed",
        "decoded_width": final["width"],
        "decoded_height": final["height"],
        "progressed_seconds": round(progressed, 2),
        "decoded_frames": final["frames"],
        "stall_windows": stalls,
        "acceptance_seconds": duration,
        "evidence": "Chromium HTMLVideoElement decoded dimensions, presented frames and sustained currentTime progression",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
