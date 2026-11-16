#!/usr/bin/env python3
"""End-to-end authenticated AI rule generation and repair acceptance."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

BASE = os.environ.get("SCRAPLING_API_BASE", "http://127.0.0.1:8000").rstrip("/")
TOKEN = os.environ["SCRAPLING_API_TOKEN"]
HOST = "ai-rule-acceptance.example"
SAMPLE = '<html><main><a id="movie-link" class="media-card" href="/ignored">Watch</a></main></html>'


def request(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read(1024 * 1024))


def wait_job(job_id):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        job = request("/v1/jobs/" + job_id)
        if job.get("status") in {"succeeded", "partial", "failed", "cancelled"}:
            if job.get("status") != "succeeded":
                raise SystemExit("FAIL: AI rule job did not succeed")
            return job
        time.sleep(2)
    raise SystemExit("FAIL: AI rule job timed out")


def enqueue(path, failure_code=None):
    payload = {"host": HOST, "page_html": SAMPLE, "fixtures": [SAMPLE], "task_id": "live-ai-acceptance"}
    if failure_code:
        payload["failure_code"] = failure_code
    result = request(path, "POST", payload)
    return wait_job(result["job_id"])


def main():
    generated = enqueue("/v1/rules/generate")
    active = request("/v1/rules/" + HOST)
    if active.get("status") != "active" or active.get("fixture_passes", 0) < 1:
        raise SystemExit("FAIL: generated selector did not pass its HTML fixture")
    previous_version = int(active["version"])

    repaired = enqueue("/v1/rules/repair", "live_acceptance_repair")
    active_after = request("/v1/rules/" + HOST)
    if int(active_after["version"]) <= previous_version or active_after.get("status") != "active":
        raise SystemExit("FAIL: repaired rule was not versioned and fixture-validated")
    print(json.dumps({
        "status": "passed",
        "generation_job": generated.get("id"),
        "repair_job": repaired.get("id"),
        "initial_version": previous_version,
        "repaired_version": active_after["version"],
        "fixture_passes": active_after["fixture_passes"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
