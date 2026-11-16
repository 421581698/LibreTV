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
    repaired_version = int(active_after["version"])
    if repaired_version <= previous_version or active_after.get("status") != "active":
        raise SystemExit("FAIL: repaired rule was not versioned and fixture-validated")

    history = request("/v1/rules/" + HOST + "/versions")["versions"]
    if not any(item["version"] == previous_version for item in history):
        raise SystemExit("FAIL: initial rule version is missing from history")
    if not any(item["version"] == repaired_version and item["is_active"] for item in history):
        raise SystemExit("FAIL: active rule pointer is missing from version history")
    diagnostics = request("/v1/rules/" + HOST + "/diagnostics")["diagnostics"]
    if not any(item.get("repair_version") == repaired_version for item in diagnostics):
        raise SystemExit("FAIL: repair diagnostic was not linked to its rule version")

    rolled_back = request(
        "/v1/rules/" + HOST + f"/versions/{previous_version}/activate", "POST"
    )
    if int(rolled_back["version"]) != previous_version:
        raise SystemExit("FAIL: validated rollback did not restore the previous version")
    restored = request(
        "/v1/rules/" + HOST + f"/versions/{repaired_version}/activate", "POST"
    )
    if int(restored["version"]) != repaired_version:
        raise SystemExit("FAIL: repaired version could not be reactivated after rollback")

    print(json.dumps({
        "status": "passed",
        "generation_job": generated.get("id"),
        "repair_job": repaired.get("id"),
        "initial_version": previous_version,
        "repaired_version": repaired_version,
        "history_versions": len(history),
        "diagnostics": len(diagnostics),
        "rollback_verified": True,
        "fixture_passes": active_after["fixture_passes"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
