#!/usr/bin/env python3
"""Opt-in real-network crawl scale test against operator-approved HTTPS URLs.

Input file: one URL per line. Every hostname must be explicitly allowlisted.
This measures completed live crawl jobs and observed page/candidate yield, not
just queue insert/claim throughput. Never run against sites without permission.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def load_targets(path: str, limit: int) -> list[str]:
    allowed = {x.strip().lower() for x in os.environ.get("LIVE_CRAWL_ALLOWED_HOSTS", "").split(",") if x.strip()}
    unique = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        url = raw.strip()
        if not url or url.startswith("#"):
            continue
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise SystemExit("FAIL: every target must be a credential-free HTTPS URL on port 443")
        host = parsed.hostname.lower().rstrip(".")
        if host not in allowed:
            raise SystemExit("FAIL: a target hostname is not in LIVE_CRAWL_ALLOWED_HOSTS")
        try:
            addresses = {ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
        except OSError as exc:
            raise SystemExit("FAIL: an approved target hostname did not resolve") from exc
        if not addresses or any(not address.is_global for address in addresses):
            raise SystemExit("FAIL: a target resolved to a private or reserved address")
        key = urlunsplit(("https", parsed.netloc.lower(), parsed.path or "/", parsed.query, ""))
        unique.setdefault(key, key)
        if len(unique) >= limit:
            break
    if len(unique) < limit:
        raise SystemExit(f"FAIL: need {limit} unique approved URLs; found {len(unique)}")
    return list(unique)[:limit]


def api(base: str, token: str, path: str, method: str = "GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        base.rstrip("/") + path, data=data,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read(2 * 1024 * 1024))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Collector API returned HTTP {exc.code}") from exc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--urls", required=True, help="approved HTTPS URL list")
    parser.add_argument("--target", type=int, choices=(1000, 2000, 5000, 10000), required=True)
    parser.add_argument("--timeout-seconds", type=int, default=86400)
    args = parser.parse_args()
    base = os.environ.get("SCRAPLING_API_BASE", "http://127.0.0.1:8000")
    token = os.environ.get("SCRAPLING_API_TOKEN", "").strip()
    if not token:
        raise SystemExit("Set SCRAPLING_API_TOKEN in the environment")
    urls = load_targets(args.urls, args.target)
    jobs = []
    for offset in range(0, len(urls), 1000):
        batch = []
        for index, url in enumerate(urls[offset:offset + 1000], start=offset):
            batch.append({
                "job_type": "crawl",
                "payload": {"url": url, "mode": "auto", "limit": 101},
                "idempotency_key": f"live-crawl-scale:{args.target}:{index}",
                "max_attempts": 2,
            })
        result = api(base, token, "/v1/jobs/bulk", "POST", {"jobs": batch})
        jobs.extend(item["id"] for item in result["jobs"])
    deadline = time.monotonic() + max(60, args.timeout_seconds)
    terminal = {"succeeded", "partial", "failed", "cancelled"}
    results = []
    while time.monotonic() < deadline:
        results = []
        for offset in range(0, len(jobs), 1000):
            batch = api(
                base, token, "/v1/jobs/status/bulk", "POST",
                {"ids": jobs[offset:offset + 1000]},
            )
            results.extend(batch["jobs"])
        if len(results) == len(jobs) and all(item["status"] in terminal for item in results):
            break
        time.sleep(5)
    completed = [item for item in results if item.get("status") in {"succeeded", "partial"}]
    failed = [item for item in results if item.get("status") in {"failed", "cancelled"}]
    pages = candidates = 0
    for item in completed:
        try:
            result = json.loads(item.get("result") or "{}")
        except (TypeError, ValueError):
            result = {}
        page_metrics = result.get("page_metrics") or {}
        pages += int(result.get("pages_visited") or page_metrics.get("visited") or 0)
        candidates += int(result.get("count") or result.get("candidate_count") or 0)
    report = {
        "target_jobs": args.target, "submitted_jobs": len(jobs),
        "terminal_jobs": len(results), "successful_or_partial_jobs": len(completed),
        "failed_or_cancelled_jobs": len(failed), "unfinished_jobs": len(jobs) - len(results),
        "observed_pages_visited": pages, "observed_candidates": candidates,
        "success_rate": round(len(completed) / len(jobs), 4) if jobs else 0,
        "status": "passed" if len(results) == len(jobs) and not failed else "incomplete_or_failed",
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
