from __future__ import annotations

import logging
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.scraper import ScraplingAdapter
from app.security import UnsafeTargetError, validate_public_http_url

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("libretv.scrapling")

app = FastAPI(
    title="LibreTV Scrapling Engine",
    version="0.2.0",
    description="Phase-one isolated crawler service built on upstream Scrapling.",
)


class FetchRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    selector: str | None = Field(default=None, max_length=500)
    mode: Literal["text", "css", "xpath", "regex"] = "text"


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
        ],
        "planned": [
            "dynamic_browser",
            "stealth_browser",
            "adaptive_element_relocation",
            "spider_jobs",
            "checkpoint_pause_resume",
            "network_api_capture",
            "robots_and_throttling_policy",
            "mcp_agent_integration",
        ],
        "service_layer": [
            "target_validation",
            "health_endpoint",
            "structured_fetch_api",
        ],
        "note": (
            "Only implemented entries have been integrated and verified by this service. "
            "Browser and spider capabilities remain planned."
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
    except Exception as exc:  # upstream errors are returned without leaking stack traces
        logger.exception("Scrapling fetch failed for %s", target)
        raise HTTPException(
            status_code=502,
            detail="Scrapling could not fetch the target.",
        ) from exc
