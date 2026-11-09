from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.job_store import JobStore
from app.scraper import ScraplingAdapter
from app.security import UnsafeTargetError, validate_public_http_url
from app.spider import ScraplingSpiderAdapter

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("libretv.scrapling")

app = FastAPI(
    title="LibreTV Scrapling Engine",
    version="0.3.0",
    description="Phase-one isolated crawler service built on upstream Scrapling.",
)
job_store = JobStore(settings.job_database_path)
job_store.initialize()
job_store.recover_interrupted()
_active_spiders: dict[str, Any] = {}
_job_tasks: dict[str, asyncio.Task] = {}


class FetchRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    selector: str | None = Field(default=None, max_length=500)
    mode: Literal["text", "css", "xpath", "regex"] = "text"


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
            raise HTTPException(status_code=409, detail="Checkpoint manifest is unreadable.") from exc
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
    spider = ScraplingSpiderAdapter.create(
        job["seeds"],
        Path(job["checkpoint_dir"]),
    )
    _active_spiders[task_id] = spider
    job_store.update(task_id, "running", started_at=_now())
    items: list[dict] = []
    try:
        async for item in spider.stream():
            items.append(item)
            job_store.add_event(
                task_id,
                "item",
                {
                    "count": len(items),
                    "url": item.get("url"),
                    "title": item.get("title"),
                },
            )
        current = job_store.get(task_id)
        paused = current is not None and current["status"] == "pausing"
        result = {
            "items": items,
            "completed": not paused,
            "paused": paused,
            "stats": asdict(spider.stats),
        }
        job_store.update(
            task_id,
            "paused" if paused else "completed",
            finished_at=_now() if not paused else None,
            result_json=json.dumps(result, ensure_ascii=False),
        )
    except asyncio.CancelledError:
        job_store.update(task_id, "paused", error="Task cancelled during service shutdown.")
        raise
    except Exception as exc:
        logger.exception("Scrapling job %s failed", task_id)
        job_store.update(task_id, "failed", finished_at=_now(), error=str(exc)[:1000])
    finally:
        _active_spiders.pop(task_id, None)
        _job_tasks.pop(task_id, None)


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
            "text_extraction",
            "markdown_conversion",
            "public_target_validation",
            "spider_seed_crawl",
            "spider_concurrency_limits",
            "spider_robots_txt_policy",
            "spider_checkpoint_storage",
            "persistent_job_registry",
            "async_job_execution",
            "job_status_api",
            "job_event_stream",
            "api_pause_resume_controls",
        ],
        "planned": [
            "dynamic_browser",
            "stealth_browser",
            "adaptive_element_relocation",
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

    try:
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
        )
        return {"ok": True, "result": result}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Scrapling fetch failed for %s", target)
        raise HTTPException(
            status_code=502,
            detail="Scrapling could not fetch the target.",
        ) from exc


@app.post("/v1/spider")
async def spider(request: SpiderRequest) -> dict:
    safe_urls = _safe_seed_urls(request.urls)
    try:
        checkpoint_dir = None
        if request.task_id:
            checkpoint_dir = Path(settings.crawl_data_dir) / request.task_id
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
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
    except Exception as exc:
        logger.exception("Scrapling spider failed for %d seed URLs", len(safe_urls))
        raise HTTPException(
            status_code=502,
            detail="Scrapling spider could not complete the crawl.",
        ) from exc


@app.post("/v1/jobs", status_code=202)
async def create_job(request: SpiderRequest) -> dict:
    safe_urls = _safe_seed_urls(request.urls)
    task_id = request.task_id or uuid.uuid4().hex
    checkpoint_dir = Path(settings.crawl_data_dir) / task_id
    _ensure_checkpoint_manifest(task_id, safe_urls, checkpoint_dir)

    created = job_store.create(task_id, safe_urls, str(checkpoint_dir))
    job = job_store.get(task_id)
    if not created:
        if job is None or job["seeds"] != safe_urls:
            raise HTTPException(
                status_code=409,
                detail="task_id already exists with a different seed configuration.",
            )
        return {"ok": True, "created": False, "job": job}

    _schedule_job(task_id)
    return {"ok": True, "created": True, "job": job_store.get(task_id)}


@app.get("/v1/jobs/{task_id}")
async def get_job(task_id: str) -> dict:
    job = job_store.get(task_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Crawl job not found.")
    return {"ok": True, "job": job}


@app.post("/v1/jobs/{task_id}/pause")
async def pause_job(task_id: str) -> dict:
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
        if path.name != "libretv-manifest.json"
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
async def job_events(task_id: str, last_event_id: int = 0) -> StreamingResponse:
    if job_store.get(task_id) is None:
        raise HTTPException(status_code=404, detail="Crawl job not found.")

    async def stream_events():
        cursor = max(last_event_id, 0)
        while True:
            events = job_store.events_after(task_id, cursor)
            for event in events:
                cursor = event["id"]
                payload = json.dumps(event, ensure_ascii=False)
                yield f"id: {cursor}\nevent: {event['type']}\ndata: {payload}\n\n"
            job = job_store.get(task_id)
            if job is None or job["status"] in {"completed", "paused", "failed"}:
                break
            if not events:
                yield ": keep-alive\n\n"
                await asyncio.sleep(1)

    return StreamingResponse(stream_events(), media_type="text/event-stream")
