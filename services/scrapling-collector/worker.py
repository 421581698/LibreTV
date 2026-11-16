from __future__ import annotations

import argparse
import hashlib
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

from app import (
    TOKEN,
    CrawlRequest,
    crawl_site,
    discover_sites,
    require_egress_firewall,
    refresh_collection_batch,
    task_candidates,
    validate_candidate,
)
from registry_queue import JobCancelled, run_worker, submit_job

# Bound automatic network validation per crawl so one discovered site cannot
# trigger an unbounded number of outbound media probes.
MAX_AUTOMATIC_MEDIA_PREFLIGHTS = 1000
MAX_BATCH_SITE_JOBS = 1000
DEFAULT_WORKER_CONCURRENCY = 2
MAX_WORKER_CONCURRENCY = 8


def handle(payload: dict, checkpoint, cancelled):
    if cancelled():
        raise JobCancelled()
    if payload.get("_job_type") == "discover":
        require_egress_firewall()
        checkpoint({"stage": "fmhy_discovery_started"})
        sites = discover_sites()
        if cancelled():
            raise JobCancelled()
        keyword = str(payload.get("search_keyword") or "")[:50]
        batch_id = str(payload.get("batch_id") or uuid.uuid4().hex)
        queued = []
        selected_sites = sites[:MAX_BATCH_SITE_JOBS]
        for site in selected_sites:
            key = f"fmhy-batch:{batch_id}:{site['host']}"
            job = submit_job("crawl", {"url":site["url"],"mode":"auto","limit":1000,"search_keyword":keyword,"batch_id":batch_id}, key)
            queued.append(job["id"])
        from app import db
        import time
        with db() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS collection_batches (
                  id TEXT PRIMARY KEY, directory_source TEXT NOT NULL DEFAULT 'FMHY',
                  target_candidates INTEGER NOT NULL DEFAULT 1000,
                  target_collected INTEGER NOT NULL DEFAULT 1000,
                  status TEXT NOT NULL DEFAULT 'queued',
                  discovered_sites INTEGER NOT NULL DEFAULT 0,
                  queued_jobs INTEGER NOT NULL DEFAULT 0,
                  candidate_count INTEGER NOT NULL DEFAULT 0,
                  collected_count INTEGER NOT NULL DEFAULT 0,
                  failure_summary TEXT NOT NULL DEFAULT '{}',
                  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
                )"""
            )
            now = int(time.time())
            connection.execute(
                """INSERT OR IGNORE INTO collection_batches
                   (id,directory_source,target_candidates,target_collected,status,created_at,updated_at)
                   VALUES(?,'FMHY',1000,1000,'queued',?,?)""",
                (batch_id, now, now),
            )
            connection.execute(
                "UPDATE collection_batches SET discovered_sites=?,queued_jobs=?,status='running',updated_at=? WHERE id=?",
                (len(sites), len(queued), now, batch_id),
            )
        checkpoint({"stage": "fmhy_sites_registered", "batch_id": batch_id, "target_candidates": 1000, "target_collected": 1000, "discovered": len(sites), "queued_jobs": len(queued)})
        return {"status": "succeeded", "batch_id": batch_id, "target_candidates": 1000, "target_collected": 1000, "discovered": len(sites), "queued_jobs": queued}

    batch_id = payload.get("batch_id")
    checkpoint({"stage": "crawl_started"})
    result = crawl_site(CrawlRequest(**payload), cancel_check=cancelled)
    if cancelled():
        raise JobCancelled()

    task_id = result.get("task_id")
    candidates = task_candidates(task_id, f"Bearer {TOKEN}").get("candidates", []) if task_id else []
    media_candidates = [
        item for item in candidates
        if item.get("kind") == "direct-media" and item.get("status") == "pending"
    ][:MAX_AUTOMATIC_MEDIA_PREFLIGHTS]
    checkpoint({
        "stage": "media_preflight_started",
        "candidate_count": len(candidates),
        "media_candidates": len(media_candidates),
    })

    preflight = {"checked": 0, "validated": 0, "rejected": 0, "errors": []}
    for candidate in media_candidates:
        if cancelled():
            raise JobCancelled()
        try:
            validation_result = validate_candidate(candidate["id"], f"Bearer {TOKEN}")
            validation = validation_result.get("validation", {})
            preflight["checked"] += 1
            if validation.get("reachable") is True and (validation.get("access") or {}).get("access_state") == "PUBLIC":
                preflight["validated"] += 1
            else:
                preflight["rejected"] += 1
        except Exception as exc:
            preflight["errors"].append({
                "candidate_id": candidate.get("id"),
                "error": type(exc).__name__,
            })
    checkpoint({
        "stage": "media_preflight_completed",
        "checked": preflight["checked"],
        "validated": preflight["validated"],
        "rejected": preflight["rejected"],
        "errors": len(preflight["errors"]),
    })
    result["preflight"] = preflight
    result["registry_ready"] = preflight["validated"]
    if batch_id:
        result["batch"] = refresh_collection_batch(batch_id)
    checkpoint({
        "stage": "candidates_persisted",
        "count": result.get("count", 0),
        "task_id": task_id,
        "registry_ready": preflight["validated"],
    })
    return result


def main():
    parser = argparse.ArgumentParser(description="LibreTV durable Scrapling job worker")
    parser.add_argument("--once", action="store_true", help="claim at most one job and exit")
    parser.add_argument("--worker-id", default=f"collector-{uuid.uuid4().hex[:8]}")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=int(os.environ.get("SCRAPLING_WORKER_CONCURRENCY", str(DEFAULT_WORKER_CONCURRENCY))),
        help=f"parallel queue consumers (1-{MAX_WORKER_CONCURRENCY}; default {DEFAULT_WORKER_CONCURRENCY})",
    )
    args = parser.parse_args()
    if not os.environ.get("SCRAPLING_API_TOKEN", "").strip():
        parser.error("SCRAPLING_API_TOKEN must be configured")
    if not 1 <= args.concurrency <= MAX_WORKER_CONCURRENCY:
        parser.error(f"--concurrency must be between 1 and {MAX_WORKER_CONCURRENCY}")
    if args.once:
        run_worker(args.worker_id, handle, once=True)
        return
    if args.concurrency == 1:
        run_worker(args.worker_id, handle, once=False)
        return
    with ThreadPoolExecutor(max_workers=args.concurrency, thread_name_prefix="collector") as pool:
        futures = [
            pool.submit(run_worker, f"{args.worker_id}-{index + 1}", handle, False)
            for index in range(args.concurrency)
        ]
        for future in futures:
            future.result()


if __name__ == "__main__":
    main()
