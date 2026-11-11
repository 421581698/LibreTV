from __future__ import annotations

import argparse
import hashlib
import os
import uuid
from urllib.parse import urlsplit, urlunsplit

import registry_queue as registry_store
from app import (
    TOKEN,
    CrawlRequest,
    crawl_site,
    discover_sites,
    require_egress_firewall,
    task_candidates,
    validate_candidate,
)
from registry_queue import JobCancelled, run_worker, submit_job

# Bound automatic network validation per crawl so one discovered site cannot
# trigger an unbounded number of outbound media probes.
MAX_AUTOMATIC_MEDIA_PREFLIGHTS = 100


def get_discovered_sites(limit: int = 50) -> list[dict]:
    with registry_store.connect() as connection:
        rows = connection.execute(
            "SELECT host,title,url,directory FROM sites WHERE directory LIKE 'FMHY / %' ORDER BY discovered_at DESC LIMIT ?",
            (max(1, min(50, limit)),),
        ).fetchall()
    return [dict(row) for row in rows]


def run_batch_crawl(payload: dict, checkpoint, cancelled) -> dict:
    require_egress_firewall()
    minimum = max(101, min(1000, int(payload.get("minimum", 101))))
    target = max(minimum, min(1000, int(payload.get("target", 250))))
    max_sites = max(1, min(50, int(payload.get("max_sites", 25))))
    sites = get_discovered_sites(max_sites)
    if not sites:
        checkpoint({"stage": "fmhy_discovery_started"})
        discover_sites()
        sites = get_discovered_sites(max_sites)

    unique_media: dict[str, dict] = {}
    preflight = {"checked": 0, "validated": 0, "rejected": 0, "errors": []}
    scanned = []
    for site in sites:
        if cancelled():
            raise JobCancelled()
        checkpoint({
            "stage": "batch_site_started",
            "host": site["host"],
            "sites_scanned": len(scanned),
            "video_candidates": len(unique_media),
            "target": target,
        })
        try:
            result = crawl_site(
                CrawlRequest(url=site["url"], mode="auto", limit=250),
                cancel_check=cancelled,
            )
        except JobCancelled:
            raise
        except Exception as exc:
            scanned.append({"host": site["host"], "status": "failed", "error": type(exc).__name__, "video_candidates": 0})
            checkpoint({"stage": "batch_site_failed", "host": site["host"], "error": type(exc).__name__})
            continue

        site_media = 0
        for candidate in result.get("candidates", []):
            if candidate.get("kind") != "direct-media":
                continue
            raw_url = candidate.get("url") or ""
            try:
                parsed = urlsplit(raw_url)
                key = urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, "", ""))
            except ValueError:
                continue
            if not key or key in unique_media:
                continue
            unique_media[key] = candidate
            site_media += 1

        # Validate a bounded sample of direct media per overall batch. Public
        # candidates only; auth/subscription/DRM states are never bypassed.
        for candidate in result.get("candidates", []):
            if preflight["checked"] + len(preflight["errors"]) >= MAX_AUTOMATIC_MEDIA_PREFLIGHTS:
                break
            if candidate.get("kind") != "direct-media" or candidate.get("status") != "pending":
                continue
            if cancelled():
                raise JobCancelled()
            try:
                checked = validate_candidate(candidate["id"], f"Bearer {TOKEN}")
                evidence = checked.get("validation", {})
                preflight["checked"] += 1
                if evidence.get("reachable") is True and (evidence.get("access") or {}).get("access_state") == "PUBLIC":
                    preflight["validated"] += 1
                else:
                    preflight["rejected"] += 1
            except Exception as exc:
                preflight["errors"].append({"candidate_id": candidate.get("id"), "error": type(exc).__name__})

        scanned.append({
            "host": site["host"], "status": result.get("status", "unknown"),
            "video_candidates": site_media, "task_id": result.get("task_id"),
        })
        checkpoint({
            "stage": "batch_site_completed",
            "host": site["host"],
            "sites_scanned": len(scanned),
            "video_candidates": len(unique_media),
            "preflight_checked": preflight["checked"],
            "preflight_validated": preflight["validated"],
            "target": target,
        })
        if len(unique_media) >= target:
            break

    collected = len(unique_media)
    met = collected >= minimum
    return {
        "status": "succeeded" if met else "partial",
        "batch_target": {
            "minimum": minimum, "target": target, "collected": collected,
            "met": met, "shortfall": max(0, minimum - collected),
        },
        "sites_scanned": len(scanned),
        "site_results": scanned,
        "preflight": preflight,
        "note": "Collected unique direct-media candidates across FMHY-discovered sites. Only validated PUBLIC direct media with browser player confirmation can enter the playable library.",
    }


def handle(payload: dict, checkpoint, cancelled):
    if cancelled():
        raise JobCancelled()
    if payload.get("_job_type") == "batch_crawl":
        return run_batch_crawl(payload, checkpoint, cancelled)
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
            job = submit_job("crawl", {"url":site["url"],"mode":"auto","limit":250,"search_keyword":keyword}, key)
            queued.append(job["id"])
        checkpoint({"stage": "fmhy_sites_registered", "discovered": len(sites), "queued_jobs": len(queued)})
        return {"status": "succeeded", "discovered": len(sites), "queued_jobs": queued}

    checkpoint({"stage": "crawl_started"})
    crawl_payload = dict(payload)
    try:
        requested_limit = int(crawl_payload.get("limit") or 250)
    except (TypeError, ValueError):
        requested_limit = 250
    crawl_payload["limit"] = max(101, min(1000, requested_limit))
    result = crawl_site(CrawlRequest(**crawl_payload), cancel_check=cancelled)
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
    args = parser.parse_args()
    if not os.environ.get("SCRAPLING_API_TOKEN", "").strip():
        parser.error("SCRAPLING_API_TOKEN must be configured")
    run_worker(args.worker_id, handle, once=args.once)


if __name__ == "__main__":
    main()
