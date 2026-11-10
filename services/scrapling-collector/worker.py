from __future__ import annotations

import argparse
import hashlib
import os
import uuid

from app import CrawlRequest, crawl_site, discover_sites, require_egress_firewall
from registry_queue import JobCancelled, run_worker, submit_job


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
        queued = []
        for site in sites[:5]:
            key = "registry-search:"+hashlib.sha256((keyword.lower()+"|"+site["host"]).encode()).hexdigest()
            job = submit_job("crawl", {"url":site["url"],"mode":"auto","limit":50,"search_keyword":keyword}, key)
            queued.append(job["id"])
        checkpoint({"stage": "fmhy_sites_registered", "discovered": len(sites), "queued_jobs": len(queued)})
        return {"status": "succeeded", "discovered": len(sites), "queued_jobs": queued}

    checkpoint({"stage": "crawl_started"})
    result = crawl_site(CrawlRequest(**payload), cancel_check=cancelled)
    if cancelled():
        raise JobCancelled()
    checkpoint({"stage": "candidates_persisted", "count": result.get("count", 0), "task_id": result.get("task_id")})
    return result


def main():
    parser = argparse.ArgumentParser(description="LibreTV durable Scrapling job worker")
    parser.add_argument("--once", action="store_true", help="claim at most one job and exit")
    parser.add_argument("--worker-id", default=f"collector-{uuid.uuid4().hex[:8]}")
    args = parser.parse_args()
    if not os.environ.get("SCRAPLING_API_TOKEN", "").strip():
        parser.error("SCRAPLING_API_TOKEN must be configured")
    run_worker(args.worker_id, handle, once=args.once)


if __name__ == "__main__":
    main()
