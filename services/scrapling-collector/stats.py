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
    # Use both edges: portrait video follows the same tiers, while 2560x1600
    # cannot become 4K merely because its short edge exceeds the cinema-scope floor.
    long_edge, short_edge = max(w, h), min(w, h)
    if long_edge >= 7680 and short_edge >= 4320: return "8K"
    # DCI/scope 4K can be 3840x1600; 3840x1080 remains 1080P.
    if long_edge >= 3840 and short_edge >= 1600: return "4K"
    if long_edge >= 2560 and short_edge >= 1440: return "2K"
    if long_edge >= 1920 and short_edge >= 1000: return "1080P"
    if long_edge >= 1280 and short_edge >= 680: return "720P"
    if long_edge >= 720 and short_edge >= 400: return "480P"
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
        """SELECT id,host,status,created_at,updated_at,error,result_count,
                  pages_scheduled,pages_visited,pages_failed,pages_changed,pages_unchanged
           FROM tasks ORDER BY created_at DESC"""
    ).fetchall()]
    candidate_columns = {row["name"] for row in connection.execute("PRAGMA table_info(candidates)").fetchall()}
    collected_by_expr = "collected_by" if "collected_by" in candidate_columns else "'[]' AS collected_by"
    media_identity_expr = "media_identity" if "media_identity" in candidate_columns else "'{}' AS media_identity"
    quality_expr = "quality_evidence" if "quality_evidence" in candidate_columns else "'{}' AS quality_evidence"
    playback_expr = "playback_verification" if "playback_verification" in candidate_columns else "'{}' AS playback_verification"
    candidates = [dict(r) for r in connection.execute(
        f"""SELECT id,task_id,url,host,kind,title,status,access_state,created_at,
                   {media_identity_expr},{quality_expr},{playback_expr},{collected_by_expr}
            FROM candidates ORDER BY created_at DESC"""
    ).fetchall()]
    try:
        job_columns = {row["name"] for row in connection.execute("PRAGMA table_info(collector_jobs)").fetchall()}
        job_result_expr = "result" if "result" in job_columns else "NULL AS result"
        jobs = [dict(r) for r in connection.execute(
            f"""SELECT id,job_type,status,attempt,max_attempts,error,{job_result_expr},created_at,updated_at
                FROM collector_jobs ORDER BY created_at DESC"""
        ).fetchall()]
    except sqlite3.OperationalError:
        jobs = []
    try:
        playback_rows = [dict(r) for r in connection.execute(
            """SELECT host,sample_source,media_type,observed_seconds,progressed_seconds,
                      decoded_width,decoded_height,selected_rendition_height,
                      selected_rendition_bitrate_kbps,created_at
               FROM playback_quality_samples ORDER BY created_at DESC"""
        ).fetchall()]
    except sqlite3.OperationalError:
        playback_rows = []

    playback_by_host = {}
    for sample in playback_rows:
        playback_by_host.setdefault(sample["host"], []).append(sample)

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
        # Only real player-originated sessions represent end-user playback.
        # Collector preview checks are useful diagnostics but must never inflate
        # playback counts, resolution distributions, or site quality rankings.
        all_site_samples = playback_by_host.get(h, [])
        site_samples = [sample for sample in all_site_samples if sample.get("sample_source") == "player"]
        preview_samples = [sample for sample in all_site_samples if sample.get("sample_source") == "collector_preview"]
        sample_evidence = site_samples
        quality = _empty_quality()
        resolution_points = {"8K":100,"4K":95,"2K":90,"1080P":80,"720P":60,"480P":40,"SD":20,"未知":0}
        resolution_scores, progress_scores, bitrate_scores = [], [], []
        observed_total = 0
        for evidence in sample_evidence:
            bucket = resolution_bucket(evidence.get("decoded_width"), evidence.get("decoded_height"))
            quality[bucket] += 1
            resolution_scores.append(resolution_points[bucket])
            observed = float(evidence.get("observed_seconds") or 0)
            progressed = float(evidence.get("progressed_seconds") or 0)
            observed_total += observed
            if observed > 0:
                progress_scores.append(min(1.0, max(0.0, progressed / observed)) * 100)
            bitrate = float(evidence.get("selected_rendition_bitrate_kbps") or 0)
            if bitrate > 0:
                bitrate_scores.append(min(1.0, bitrate / 8000.0) * 100)
        quality_score = None
        if len(sample_evidence) >= 1 and observed_total >= 5 and progress_scores:
            resolution_average = sum(resolution_scores) / len(resolution_scores)
            progress_average = sum(progress_scores) / len(progress_scores)
            if bitrate_scores:
                quality_score = round(0.55 * resolution_average + 0.25 * (sum(bitrate_scores) / len(bitrate_scores)) + 0.20 * progress_average)
            else:
                quality_score = round(0.70 * resolution_average + 0.30 * progress_average)
        succeeded = sum(1 for t in site_tasks if t["status"] in ("completed", "succeeded"))
        failed = sum(1 for t in site_tasks if t["status"] == "failed")
        registry = resources_by_host.get(h, {})
        failure_streak = 0
        for task in site_tasks:
            if task["status"] in ("failed", "interrupted"):
                failure_streak += 1
            elif task["status"] in ("completed", "succeeded"):
                break
            else:
                break
        health_status = (
            "unknown" if not site_tasks else
            "failing" if failure_streak >= 3 else
            "degraded" if latest and latest["status"] in ("failed", "interrupted", "partial") else
            "healthy" if latest and latest["status"] in ("completed", "succeeded") else "unknown"
        )
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
            "health_status": health_status, "failure_streak": failure_streak,
            "playback_samples": len(site_samples), "preview_samples": len(preview_samples), "quality_score": quality_score,
            "quality_score_state": ("preliminary" if len(sample_evidence) < 3 else "scored") if quality_score is not None else "insufficient_samples",
            "pages_visited": sum(int(t.get("pages_visited") or 0) for t in site_tasks),
            "pages_succeeded": sum(int(t.get("pages_visited") or 0) for t in site_tasks),
            "pages_failed": sum(int(t.get("pages_failed") or 0) for t in site_tasks),
            "pages_changed": sum(int(t.get("pages_changed") or 0) for t in site_tasks),
            "pages_unchanged": sum(int(t.get("pages_unchanged") or 0) for t in site_tasks)
        })

    if host: site_summaries = [s for s in site_summaries if s["host"] == host]
    quality_total = _empty_quality()
    for site in site_summaries:
        for key in QUALITY_BUCKETS: quality_total[key] += site["actual_quality"][key]

    visited_hosts = {t["host"] for t in tasks}
    latest_by_host = {}
    for task in tasks: latest_by_host.setdefault(task["host"], task)
    queue_jobs = {
        state: sum(1 for job in jobs if job["status"] == state)
        for state in ("queued", "running", "succeeded", "failed", "cancelled", "cancel_requested")
    }
    queue_jobs["total"] = len(jobs)
    quality_ranking = sorted(
        [{"host": site["host"], "title": site["title"], "score": site["quality_score"],
          "samples": site["playback_samples"]}
         for site in site_summaries if site.get("quality_score") is not None],
        key=lambda item: (-item["score"], -item["samples"], item["host"])
    )
    candidate_kind_counts = {}
    candidate_access_counts = {}
    media_type_counts = {"movie": 0, "tv": 0, "anime": 0, "documentary": 0, "variety": 0, "short": 0, "unknown": 0}
    identified_title_keys = set()
    for candidate in candidates:
        identity = _json(candidate.get("media_identity"))
        media_type = str(identity.get("media_type") or "unknown")
        if media_type not in media_type_counts: media_type = "unknown"
        media_type_counts[media_type] += 1
        if identity.get("title_hint") and identity.get("match_confidence") in ("structured_metadata", "page_metadata"):
            identified_title_keys.add((media_type, str(identity.get("title_hint")).casefold(), identity.get("year_hint")))
    identified_title_count = len(identified_title_keys)
    candidate_collector_counts = {"spider": 0, "browser": 0, "fmhy": 0, "unknown": 0}
    for candidate in candidates:
        kind = str(candidate.get("kind") or "unknown")
        candidate_kind_counts[kind] = candidate_kind_counts.get(kind, 0) + 1
        access_state = str(candidate.get("access_state") or "ACCESS_UNKNOWN")
        candidate_access_counts[access_state] = candidate_access_counts.get(access_state, 0) + 1
        try:
            collectors = json.loads(candidate.get("collected_by") or "[]")
        except (TypeError, ValueError):
            collectors = []
        if not isinstance(collectors, list):
            collectors = []
        recognized = {value for value in collectors if value in ("spider", "browser", "fmhy")}
        if not recognized:
            candidate_collector_counts["unknown"] += 1
        else:
            for source in recognized:
                candidate_collector_counts[source] += 1

    summary = {
        "candidate_records": len(candidates),
        "candidate_kinds": candidate_kind_counts,
        "media_type_counts": media_type_counts,
        "identified_titles": identified_title_count,
        "unclassified_candidates": media_type_counts["unknown"],
        "candidate_access_states": candidate_access_counts,
        "candidate_collectors": candidate_collector_counts,
        "discovered_sites": len(sites), "visited_sites": len(visited_hosts),
        "quality_ranking": quality_ranking,
        "queue_jobs": queue_jobs,
        "successful_sites": sum(1 for t in latest_by_host.values() if t["status"] in ("completed", "succeeded")),
        "failed_sites": sum(1 for t in latest_by_host.values() if t["status"] == "failed"),
        "crawl_tasks": len(tasks),
        "pages_visited": sum(int(t.get("pages_visited") or 0) for t in tasks),
        "pages_failed": sum(int(t.get("pages_failed") or 0) for t in tasks),
        "pages_changed": sum(int(t.get("pages_changed") or 0) for t in tasks),
        "pages_unchanged": sum(int(t.get("pages_unchanged") or 0) for t in tasks),
        "candidate_resources": sum(s["candidate_count"] for s in site_summaries),
        "video_candidates": sum(s["video_candidates"] for s in site_summaries),
        "preflight_passed": sum(s["preflight_passed"] for s in site_summaries),
        "playback_confirmed": sum(s["playback_confirmed"] for s in site_summaries),
        "playback_samples": sum(s["playback_samples"] for s in site_summaries),
        "preview_samples": sum(s["preview_samples"] for s in site_summaries),
        "actual_quality": quality_total,
        "movie_entries": sum(s["movie_entries"] for s in site_summaries),
        "episode_entries": sum(s["episode_entries"] for s in site_summaries)
    }
    response = {
        "source": "collector_sqlite", "generated_at": int(time.time()),
        "summary": summary, "sites": site_summaries,
        "recent_jobs": [
            {
                **{k: job.get(k) for k in ("id","job_type","status","attempt","max_attempts","error","created_at","updated_at")},
                "batch_target": _json(job.get("result")).get("batch_target"),
                "sites_scanned": _json(job.get("result")).get("sites_scanned"),
                "preflight": _json(job.get("result")).get("preflight"),
            }
            for job in jobs[:20]
        ],
        "data_notes": [
            "Counts are derived from persisted Collector SQLite records.",
            "Candidates, public preflight approvals, and player-confirmed playback are separate states.",
            "Actual quality uses decoded video dimensions only; missing dimensions are unknown.",
            "Page visit counts are persisted from Spider processed pages and browser top-level visits; counts are engine visits, not cross-engine deduplicated URLs.",
            "pages_failed is scheduled pages minus processed visits; it represents uncompleted visits and is not proof that every page returned an HTTP error.",
            "Content fingerprints track page changes for diagnostics; pages are re-extracted even when unchanged so parser upgrades can discover previously missed candidates."
        ]
    }
    if host:
        response["site"] = site_summaries[0] if site_summaries else None
        response["recent_tasks"] = [
            {k: t.get(k) for k in ("id","status","created_at","updated_at","error","result_count")}
            for t in tasks_by_host.get(host, [])[:20]
        ]
        response["recent_resources"] = [{
            "title": (_json(c.get("media_identity")).get("title_hint")
                      if _json(c.get("media_identity")).get("match_confidence") in ("structured_metadata", "page_metadata")
                      else c.get("title")) or "待识别资源",
            "media_type": _json(c.get("media_identity")).get("media_type", "unknown"),
            "year": _json(c.get("media_identity")).get("year_hint"),
            "season": _json(c.get("media_identity")).get("season_hint"),
            "episode": _json(c.get("media_identity")).get("episode_hint"),
            "identity_confidence": _json(c.get("media_identity")).get("match_confidence", "hint_only"),
            "kind": c.get("kind"), "status": c.get("status"),
            "access_state": c.get("access_state"),
            "playback_confirmed": _json(c.get("playback_verification")).get("state") == "PLAYER_CONFIRMED",
            "decoded_width": _json(c.get("playback_verification")).get("decoded_width", 0),
            "decoded_height": _json(c.get("playback_verification")).get("decoded_height", 0),
            "actual_quality": resolution_bucket(
                _json(c.get("playback_verification")).get("decoded_width"),
                _json(c.get("playback_verification")).get("decoded_height")
            ) if _json(c.get("playback_verification")).get("state") == "PLAYER_CONFIRMED" else "未知",
            "declared_quality": (_json(c.get("quality_evidence")).get("declared_quality_label")
                                 or _json(c.get("media_identity")).get("quality_hint")),
            "poster": _json(c.get("media_identity")).get("poster"),
            "created_at": c.get("created_at")
        } for c in candidates_by_host.get(host, [])[:50]]
    return response
