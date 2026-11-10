"""Evidence-based statistics over the Scrapling Collector SQLite database."""
from __future__ import annotations
import json
import sqlite3
import time
from urllib.parse import urlsplit

QUALITY_BUCKETS = ("8K", "4K", "2K", "1080P", "720P", "480P", "SD", "未知")

def resolution_bucket(width, height):
    try:
        w, h = int(width or 0), int(height or 0)
    except (TypeError, ValueError):
        return "未知"
    if w <= 0 or h <= 0: return "未知"
    # Use decoded vertical resolution tiers. Width alone can misclassify ultrawide
    # 1080p video (for example 3840x1080) as 4K.
    if h >= 4320: return "8K"
    if h >= 2000: return "4K"
    if h >= 1400: return "2K"
    if h >= 1000: return "1080P"
    if h >= 680: return "720P"
    if h >= 400: return "480P"
    return "SD"

def _json(value):
    if isinstance(value, dict): return value
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}

def _canonical_url(raw):
    try:
        parsed = urlsplit(raw)
        return f"{parsed.scheme.lower()}://{(parsed.hostname or '').lower()}{parsed.path or '/'}"
    except (TypeError, ValueError):
        return str(raw or "")

def _empty_quality():
    return {key: 0 for key in QUALITY_BUCKETS}

def build_stats(connection: sqlite3.Connection, host=None):
    connection.row_factory = sqlite3.Row
    sites = [dict(r) for r in connection.execute(
        "SELECT host,title,url,directory,discovered_at FROM sites ORDER BY discovered_at DESC"
    ).fetchall()]
    tasks = [dict(r) for r in connection.execute(
        "SELECT id,host,status,created_at,updated_at,error,result_count FROM tasks ORDER BY created_at DESC"
    ).fetchall()]
    candidates = [dict(r) for r in connection.execute(
        """SELECT id,task_id,url,host,kind,title,status,access_state,created_at,
                  quality_evidence,playback_verification
           FROM candidates ORDER BY created_at DESC"""
    ).fetchall()]

    resources_by_host = {}
    try:
        rows = connection.execute(
            """SELECT s.host,COUNT(DISTINCT r.movie_id) AS movie_entries,
                      COUNT(DISTINCT r.episode_id) AS episode_entries,
                      COUNT(DISTINCT r.id) AS registry_resources
               FROM registry_resources r
               LEFT JOIN registry_sources s ON s.id=r.source_id GROUP BY s.host"""
        ).fetchall()
        resources_by_host = {str(r["host"] or ""): dict(r) for r in rows}
    except sqlite3.OperationalError:
        pass

    tasks_by_host, candidates_by_host = {}, {}
    for task in tasks: tasks_by_host.setdefault(task["host"], []).append(task)
    for candidate in candidates: candidates_by_host.setdefault(candidate["host"], []).append(candidate)

    site_summaries = []
    for site in sites:
        h = site["host"]
        site_tasks = tasks_by_host.get(h, [])
        site_candidates = candidates_by_host.get(h, [])
        unique_candidates, unique_video, unique_confirmed = {}, {}, {}
        quality = _empty_quality()
        for item in site_candidates:
            key = _canonical_url(item["url"])
            unique_candidates.setdefault(key, item)
            if item["kind"] in ("direct-media", "embedded-player"):
                unique_video.setdefault(key, item)
            playback = _json(item.get("playback_verification"))
            if playback.get("state") == "PLAYER_CONFIRMED":
                unique_confirmed.setdefault(key, item)
                quality[resolution_bucket(
                    playback.get("decoded_width", playback.get("decodedWidth")),
                    playback.get("decoded_height", playback.get("decodedHeight"))
                )] += 1

        latest = site_tasks[0] if site_tasks else None
        last_error = next((t["error"] for t in site_tasks if t.get("error")), None)
        preflight = sum(1 for item in unique_video.values()
                        if item.get("status") == "validated" and item.get("access_state") == "PUBLIC")
        succeeded = sum(1 for t in site_tasks if t["status"] in ("completed", "succeeded"))
        failed = sum(1 for t in site_tasks if t["status"] == "failed")
        registry = resources_by_host.get(h, {})
        site_summaries.append({
            "host": h, "title": site["title"], "url": site["url"], "directory": site["directory"],
            "discovered_at": site["discovered_at"], "crawl_tasks": len(site_tasks),
            "succeeded_tasks": succeeded, "failed_tasks": failed,
            "last_crawl_at": latest["updated_at"] if latest else None,
            "last_status": latest["status"] if latest else "not_crawled", "last_error": last_error,
            "candidate_count": len(unique_candidates), "video_candidates": len(unique_video),
            "preflight_passed": preflight, "playback_confirmed": len(unique_confirmed),
            "actual_quality": quality,
            "movie_entries": int(registry.get("movie_entries") or 0),
            "episode_entries": int(registry.get("episode_entries") or 0),
            "registry_resources": int(registry.get("registry_resources") or 0),
            "pages_visited": None, "pages_succeeded": None, "pages_failed": None
        })

    if host: site_summaries = [s for s in site_summaries if s["host"] == host]
    quality_total = _empty_quality()
    for site in site_summaries:
        for key in QUALITY_BUCKETS: quality_total[key] += site["actual_quality"][key]

    visited_hosts = {t["host"] for t in tasks}
    latest_by_host = {}
    for task in tasks: latest_by_host.setdefault(task["host"], task)
    summary = {
        "discovered_sites": len(sites), "visited_sites": len(visited_hosts),
        "successful_sites": sum(1 for t in latest_by_host.values() if t["status"] in ("completed", "succeeded")),
        "failed_sites": sum(1 for t in latest_by_host.values() if t["status"] == "failed"),
        "crawl_tasks": len(tasks),
        "candidate_resources": sum(s["candidate_count"] for s in site_summaries),
        "video_candidates": sum(s["video_candidates"] for s in site_summaries),
        "preflight_passed": sum(s["preflight_passed"] for s in site_summaries),
        "playback_confirmed": sum(s["playback_confirmed"] for s in site_summaries),
        "actual_quality": quality_total,
        "movie_entries": sum(s["movie_entries"] for s in site_summaries),
        "episode_entries": sum(s["episode_entries"] for s in site_summaries)
    }
    response = {
        "source": "collector_sqlite", "generated_at": int(time.time()),
        "summary": summary, "sites": site_summaries,
        "data_notes": [
            "Counts are derived from persisted Collector SQLite records.",
            "Candidates, public preflight approvals, and player-confirmed playback are separate states.",
            "Actual quality uses decoded video dimensions only; missing dimensions are unknown.",
            "Page-level visit events are not persisted by the current Collector schema."
        ]
    }
    if host:
        response["site"] = site_summaries[0] if site_summaries else None
        response["recent_tasks"] = [
            {k: t.get(k) for k in ("id","status","created_at","updated_at","error","result_count")}
            for t in tasks_by_host.get(host, [])[:20]
        ]
        response["recent_resources"] = [{
            "title": c.get("title") or c.get("host"), "kind": c.get("kind"),
            "status": c.get("status"), "access_state": c.get("access_state"),
            "playback_confirmed": _json(c.get("playback_verification")).get("state") == "PLAYER_CONFIRMED",
            "decoded_width": _json(c.get("playback_verification")).get("decoded_width", 0),
            "decoded_height": _json(c.get("playback_verification")).get("decoded_height", 0),
            "created_at": c.get("created_at")
        } for c in candidates_by_host.get(host, [])[:50]]
    return response
