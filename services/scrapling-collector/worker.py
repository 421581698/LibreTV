"""Standalone durable collector worker.

Run as a separate process/container: python worker.py. It shares the collector
SQLite volume with the API and uses transactional leases to avoid duplicate work.
"""
from __future__ import annotations

import os
import socket
import time

from app import CrawlRequest, crawl_site
from registry_store import claim, finish, upsert_resource

WORKER_ID = os.environ.get("SCRAPLING_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"


def run_once() -> bool:
    job = claim(WORKER_ID, lease_seconds=900)
    if not job:
        return False
    try:
        result = crawl_site(CrawlRequest(url=job["url"], mode=job["mode"], limit=100))
        for item in result.get("candidates", []):
            kind = item.get("kind")
            resource_type = {
                "cms-api-candidate": "CMS_VOD",
                "direct-media": "DIRECT_MEDIA",
                "embedded-player": "EMBEDDED_PLAYER",
            }.get(kind)
            if not resource_type:
                continue
            upsert_resource(
                source_key=item.get("host") or "fmhy-discovered",
                source_name=item.get("host") or "FMHY discovered source",
                url=item["url"],
                resource_type=resource_type,
                title=item.get("title") or "",
                access_state=item.get("access_state") or "ACCESS_UNKNOWN",
                validation_state="unverified",
                metadata={"collector_task_id": result.get("task_id"), "candidate_id": item.get("id")},
            )
        status = "partial" if result.get("status") == "partial" else "succeeded"
        finish(job["id"], WORKER_ID, status, result={
            "collector_task_id": result.get("task_id"),
            "candidate_count": result.get("count", 0),
        })
    except Exception as exc:
        try:
            finish(job["id"], WORKER_ID, "failed", error=type(exc).__name__)
        except (KeyError, PermissionError):
            pass
    return True


def main() -> None:
    idle_sleep = max(1, min(30, int(os.environ.get("SCRAPLING_WORKER_IDLE_SECONDS", "5"))))
    while True:
        if not run_once():
            time.sleep(idle_sleep)


if __name__ == "__main__":
    main()
