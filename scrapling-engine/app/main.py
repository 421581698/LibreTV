from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import secrets
import uuid
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.catalog_store import CatalogStore
from app.config import settings
from app.fmhy_catalog import sync_fmhy_catalog
from app.job_store import JobStore
from app.robots import RobotsPolicyError, RobotsUnavailableError, ensure_robots_allowed
from app.scraper import ScraplingAdapter
from app.security import UnsafeTargetError, validate_public_http_url
from app.spider import ScraplingSpiderAdapter

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("libretv.scrapling")


def _is_loopback_host(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


if settings.api_key is None and not _is_loopback_host(settings.host):
    raise RuntimeError(
        "SCRAPLING_API_KEY is required when the service binds to a non-loopback host."
    )

app = FastAPI(
    title="LibreTV Scrapling Engine",
    version="0.3.0",
    description="Phase-one isolated crawler service built on upstream Scrapling.",
)
job_store = JobStore(settings.job_database_path)
catalog_store = CatalogStore(settings.catalog_database_path)
catalog_store.initialize()
_catalog_sync_lock = asyncio.Lock()
job_store.initialize()
job_store.recover_interrupted()
_active_spiders: dict[str, Any] = {}
_legacy_task_ids: set[str] = set()
_job_tasks: dict[str, asyncio.Task] = {}
_job_transition_lock = asyncio.Lock()


class FetchRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    selector: str | None = Field(default=None, max_length=500)
    mode: Literal[
        "text", "css", "xpath", "regex", "adaptive_css", "adaptive_xpath"
    ] = "text"
    adaptive_action: Literal["save", "relocate"] | None = None


class SpiderRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=20)
    task_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )


def _safe_seed_urls(urls: list[str]) -> list[str]:
    safe_urls: list[str] = []
    try:
        for url in urls:
            safe_url = validate_public_http_url(url)
            if safe_url not in safe_urls:
                safe_urls.append(safe_url)
    except UnsafeTargetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return safe_urls


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _ensure_checkpoint_manifest(
    task_id: str,
    seeds: list[str],
    checkpoint_dir: Path,
) -> None:
    manifest = checkpoint_dir / "libretv-manifest.json"
    if manifest.exists():
        try:
            saved = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=409,
                detail="Checkpoint manifest is unreadable.",
            ) from exc
        if saved.get("task_id") != task_id or saved.get("seeds") != seeds:
            raise HTTPException(
                status_code=409,
                detail="Checkpoint directory belongs to a different task configuration.",
            )
        return
    if checkpoint_dir.exists() and any(checkpoint_dir.iterdir()):
        raise HTTPException(
            status_code=409,
            detail="Checkpoint directory contains unregistered data.",
        )
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    temporary = manifest.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"task_id": task_id, "seeds": seeds}, ensure_ascii=False),
        encoding="utf-8",
    )
    temporary.replace(manifest)


def _schedule_job(task_id: str) -> None:
    existing = _job_tasks.get(task_id)
    if existing and not existing.done():
        return
    task = asyncio.create_task(_run_job(task_id), name=f"scrapling-job-{task_id}")
    _job_tasks[task_id] = task


async def _run_job(task_id: str) -> None:
    job = job_store.get(task_id)
    if job is None:
        return
    spider = None
    items: list[dict] = job_store.get_results(task_id)
    seen_urls = {item.get("url") for item in items if item.get("url")}
    previous_result = job.get("result") or {}
    stats = previous_result.get("stats", {})
    try:
        spider = ScraplingSpiderAdapter.create(
            job["seeds"],
            Path(job["checkpoint_dir"]),
        )
        _active_spiders[task_id] = spider
        job_store.update(task_id, "running", started_at=job["started_at"] or _now())
        async for item in spider.stream():
            item_url = item.get("url")
            if item_url and item_url in seen_urls:
                continue
            job_store.add_result(task_id, item)
            items.append(item)
            if item_url:
                seen_urls.add(item_url)
            stats = asdict(spider.stats)
            job_store.add_event(
                task_id,
                "item",
                {
                    "count": len(items),
                    "url": item_url,
                    "title": item.get("title"),
                },
            )
        async with _job_transition_lock:
            current = job_store.get(task_id)
            pause_requested = current is not None and current["status"] == "pausing"
            checkpoint_dir = Path(job["checkpoint_dir"])
            has_checkpoint = checkpoint_dir.is_dir() and any(
                path.is_file()
                and path.name != "libretv-manifest.json"
                and not path.name.endswith(".tmp")
                for path in checkpoint_dir.iterdir()
            )
            if pause_requested and has_checkpoint:
                final_status = "paused"
            elif pause_requested and len(items) < len(job["seeds"]):
                final_status = "interrupted"
            else:
                final_status = "completed"
            result = {
                "items": items,
                "completed": final_status == "completed",
                "paused": final_status == "paused",
                "stats": stats,
            }
            job_store.update(
                task_id,
                final_status,
                finished_at=_now() if final_status in {"completed", "failed"} else None,
                error=(
                    "Pause ended without a persisted checkpoint."
                    if final_status == "interrupted"
                    else None
                ),
                result_json=json.dumps(result, ensure_ascii=False),
            )
    except asyncio.CancelledError:
        job_store.update(
            task_id,
            "interrupted",
            error="Task cancelled before a checkpoint was confirmed.",
        )
        raise
    except Exception as exc:
        logger.exception("Scrapling job %s failed", task_id)
        job_store.update(
            task_id,
            "failed",
            finished_at=_now(),
            error=f"{type(exc).__name__}: crawl failed",
        )
    finally:
        _active_spiders.pop(task_id, None)
        current_task = asyncio.current_task()
        if _job_tasks.get(task_id) is current_task:
            _job_tasks.pop(task_id, None)
        latest = job_store.get(task_id)
        if latest is not None and latest["status"] == "queued":
            _schedule_job(task_id)


async def stop_active_crawls() -> None:
    async with _job_transition_lock:
        for task_id, spider_instance in list(_active_spiders.items()):
            job_store.update(task_id, "pausing")
            try:
                spider_instance.pause()
            except RuntimeError:
                job_store.update(
                    task_id,
                    "interrupted",
                    error="Service shutdown occurred before the crawler loop was ready.",
                )
    tasks = list(_job_tasks.values())
    if tasks:
        _, pending = await asyncio.wait(tasks, timeout=30)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await stop_active_crawls()


app.router.lifespan_context = lifespan


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    if request.url.path.startswith("/v1/") and settings.api_key is not None:
        supplied = request.headers.get("x-api-key", "")
        expected = settings.api_key.get_secret_value()
        if not secrets.compare_digest(supplied, expected):
            return JSONResponse(
                status_code=401,
                content={"detail": "A valid X-API-Key header is required."},
            )
    return await call_next(request)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "engine": "scrapling", "phase": "1"}


@app.get("/capabilities")
async def capabilities() -> dict:
    return {
        "upstream": "D4Vinci/Scrapling",
        "implemented": [
            "http_fetch",
            "safe_redirect_policy",
            "css_extraction",
            "xpath_extraction",
            "regex_extraction",
            "adaptive_css_extraction",
            "adaptive_xpath_extraction",
            "text_extraction",
            "markdown_conversion",
            "public_target_validation",
            "spider_seed_crawl",
            "spider_concurrency_limits",
            "spider_robots_txt_policy",
            "one_off_fetch_robots_policy",
            "spider_checkpoint_storage",
            "persistent_job_registry",
            "async_job_execution",
            "job_status_api",
            "job_event_stream",
            "api_pause_resume_controls",
            "fmhy_official_markdown_import",
            "versioned_resource_catalog",
            "normalized_domain_index",
        ],
        "planned": [
            "dynamic_browser",
            "stealth_browser",
            "recursive_link_crawling",
            "network_api_capture",
            "mcp_agent_integration",
        ],
        "service_layer": [
            "target_validation",
            "health_endpoint",
            "structured_fetch_api",
            "sqlite_job_registry",
        ],
        "note": (
            "Only implemented entries have been integrated. Browser and recursive crawling "
            "remain disabled until request-level and deployment egress protections are verified."
        ),
    }


@app.post("/v1/fetch")
async def fetch(request: FetchRequest) -> dict:
    try:
        target = validate_public_http_url(request.url)
    except UnsafeTargetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if request.mode != "text" and not request.selector:
        raise HTTPException(
            status_code=422,
            detail=f"A selector or pattern is required for {request.mode} extraction.",
        )
    if request.mode.startswith("adaptive_") and request.adaptive_action is None:
        raise HTTPException(
            status_code=422,
            detail="Adaptive extraction requires adaptive_action='save' or 'relocate'.",
        )
    if not request.mode.startswith("adaptive_") and request.adaptive_action is not None:
        raise HTTPException(
            status_code=422,
            detail="adaptive_action is only valid for adaptive extraction modes.",
        )

    try:
        await run_in_threadpool(
            ensure_robots_allowed,
            target,
            settings.request_timeout_seconds,
        )
        page = await run_in_threadpool(
            ScraplingAdapter.fetch_page,
            target,
            settings.request_timeout_seconds,
        )
        result = await run_in_threadpool(
            ScraplingAdapter.extract,
            page,
            request.selector,
            request.mode,
            adaptive_action=request.adaptive_action,
        )
        return {"ok": True, "result": result}
    except RobotsPolicyError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except RobotsUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Scrapling fetch failed for host %s", urlsplit(target).hostname)
        raise HTTPException(
            status_code=502,
            detail="Scrapling could not fetch the target.",
        ) from exc


@app.post("/v1/spider")
async def spider(request: SpiderRequest) -> dict:
    safe_urls = _safe_seed_urls(request.urls)
    if request.task_id:
        async with _job_transition_lock:
            if (
                request.task_id in _legacy_task_ids
                or job_store.get(request.task_id) is not None
            ):
                raise HTTPException(
                    status_code=409,
                    detail="task_id is already in use; use a new ID or the managed jobs API.",
                )
            _legacy_task_ids.add(request.task_id)

    try:
        checkpoint_dir = None
        if request.task_id:
            checkpoint_dir = (
                Path(settings.crawl_data_dir).expanduser().resolve() / request.task_id
            )
            _ensure_checkpoint_manifest(request.task_id, safe_urls, checkpoint_dir)
        result = await run_in_threadpool(
            ScraplingSpiderAdapter.crawl,
            safe_urls,
            checkpoint_dir,
        )
        return {
            "ok": True,
            "task_id": request.task_id,
            "checkpoint_enabled": checkpoint_dir is not None,
            "result": result,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Scrapling spider failed for %d seed URLs", len(safe_urls))
        raise HTTPException(
            status_code=502,
            detail="Scrapling spider could not complete the crawl.",
        ) from exc
    finally:
        if request.task_id:
            async with _job_transition_lock:
                _legacy_task_ids.discard(request.task_id)


@app.post("/v1/jobs", status_code=202)
async def create_job(request: SpiderRequest) -> dict:
    safe_urls = _safe_seed_urls(request.urls)
    task_id = request.task_id or uuid.uuid4().hex
    checkpoint_dir = Path(settings.crawl_data_dir).expanduser().resolve() / task_id

    async with _job_transition_lock:
        if task_id in _legacy_task_ids:
            raise HTTPException(
                status_code=409,
                detail="task_id is currently running through the legacy Spider API.",
            )
        existing = job_store.get(task_id)
        if existing is not None:
            if existing["seeds"] != safe_urls:
                raise HTTPException(
                    status_code=409,
                    detail="task_id already exists with a different seed configuration.",
                )
            _ensure_checkpoint_manifest(
                task_id,
                existing["seeds"],
                Path(existing["checkpoint_dir"]),
            )
            if existing["status"] == "queued":
                _schedule_job(task_id)
            return {"ok": True, "created": False, "job": job_store.get(task_id)}

        _ensure_checkpoint_manifest(task_id, safe_urls, checkpoint_dir)
        job_store.create(task_id, safe_urls, str(checkpoint_dir))
        _schedule_job(task_id)
        return {"ok": True, "created": True, "job": job_store.get(task_id)}


@app.get("/v1/jobs/{task_id}")
async def get_job(task_id: str) -> dict:
    job = job_store.get(task_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Crawl job not found.")
    if job["status"] != "completed":
        job["partial_results"] = job_store.get_results(task_id)
    return {"ok": True, "job": job}


@app.post("/v1/jobs/{task_id}/pause")
async def pause_job(task_id: str) -> dict:
    async with _job_transition_lock:
        job = job_store.get(task_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Crawl job not found.")
        spider_instance = _active_spiders.get(task_id)
        if job["status"] != "running" or spider_instance is None:
            raise HTTPException(status_code=409, detail="Crawl job is not currently pausable.")
        job_store.update(task_id, "pausing")
        try:
            spider_instance.pause()
        except RuntimeError as exc:
            job_store.update(
                task_id,
                "running",
                error="Pause request rejected before crawl loop started.",
            )
            raise HTTPException(
                status_code=409,
                detail="Spider has not started its crawl loop.",
            ) from exc
        return {"ok": True, "task_id": task_id, "status": "pausing"}


@app.post("/v1/jobs/{task_id}/resume", status_code=202)
async def resume_job(task_id: str) -> dict:
    async with _job_transition_lock:
        job = job_store.get(task_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Crawl job not found.")
        if job["status"] not in {"paused", "interrupted"}:
            raise HTTPException(
                status_code=409,
                detail="Only paused or interrupted jobs can be resumed.",
            )
        checkpoint_dir = Path(job["checkpoint_dir"])
        _ensure_checkpoint_manifest(task_id, job["seeds"], checkpoint_dir)
        checkpoint_files = [
            path for path in checkpoint_dir.iterdir()
            if path.is_file()
            and path.name != "libretv-manifest.json"
            and not path.name.endswith(".tmp")
        ]
        if not checkpoint_files:
            raise HTTPException(
                status_code=409,
                detail="No saved Scrapling checkpoint is available for this job.",
            )
        job_store.update(task_id, "queued", finished_at=None, error=None)
        _schedule_job(task_id)
        return {"ok": True, "task_id": task_id, "status": "queued"}


@app.get("/v1/jobs/{task_id}/events")
async def job_events(
    task_id: str,
    request: Request,
    last_event_id: int = 0,
) -> StreamingResponse:
    if job_store.get(task_id) is None:
        raise HTTPException(status_code=404, detail="Crawl job not found.")

    async def stream_events():
        header_cursor = request.headers.get("last-event-id", "0")
        try:
            cursor = max(last_event_id, int(header_cursor))
        except ValueError:
            cursor = max(last_event_id, 0)
        while True:
            events = job_store.events_after(task_id, cursor)
            for event in events:
                cursor = event["id"]
                payload = json.dumps(event, ensure_ascii=False)
                yield f"id: {cursor}\nevent: {event['type']}\ndata: {payload}\n\n"
            job = job_store.get(task_id)
            if job is None or job["status"] in {"completed", "paused", "failed", "interrupted"}:
                break
            if not events:
                yield ": keep-alive\n\n"
                await asyncio.sleep(1)

    return StreamingResponse(stream_events(), media_type="text/event-stream")



@app.post("/v1/catalog/fmhy/sync")
async def sync_fmhy_directory() -> dict:
    async with _catalog_sync_lock:
        try:
            result = await sync_fmhy_catalog(catalog_store)
            return {"ok": True, **result}
        except Exception as exc:
            logger.exception("FMHY catalog synchronization failed")
            raise HTTPException(
                status_code=502,
                detail=(
                    "FMHY official catalog synchronization failed; "
                    "previous snapshot was retained."
                ),
            ) from exc


@app.get("/v1/catalog/snapshot")
async def get_catalog_snapshot() -> dict:
    snapshot = catalog_store.latest_snapshot()
    if snapshot is None:
        raise HTTPException(status_code=404, detail="FMHY catalog has not been synchronized.")
    return {"ok": True, "snapshot": snapshot}


@app.get("/v1/catalog/entries")
async def get_catalog_entries(
    category: str | None = Query(default=None, max_length=80),
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    include_unsafe: bool = False,
) -> dict:
    snapshot = catalog_store.latest_snapshot()
    if snapshot is None:
        raise HTTPException(status_code=404, detail="FMHY catalog has not been synchronized.")
    entries = catalog_store.list_entries(
        snapshot_id=snapshot["snapshot_id"],
        category=category,
        query=q,
        limit=limit,
        offset=offset,
        include_unsafe=include_unsafe,
    )
    return {
        "ok": True,
        "snapshot_id": snapshot["snapshot_id"],
        "count": len(entries),
        "entries": entries,
    }


@app.get("/v1/catalog/domains")
async def get_catalog_domains(
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    include_unsafe: bool = False,
) -> dict:
    snapshot = catalog_store.latest_snapshot()
    if snapshot is None:
        raise HTTPException(status_code=404, detail="FMHY catalog has not been synchronized.")
    domains = catalog_store.list_domains(
        snapshot_id=snapshot["snapshot_id"],
        query=q,
        limit=limit,
        offset=offset,
        include_unsafe=include_unsafe,
    )
    return {
        "ok": True,
        "snapshot_id": snapshot["snapshot_id"],
        "count": len(domains),
        "domains": domains,
    }
