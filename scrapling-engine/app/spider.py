from __future__ import annotations

import asyncio
from dataclasses import asdict
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from scrapling.spiders import Response, Spider


class _SeedSpider(Spider):
    """A polite, seed-only Spider; link expansion stays disabled pending egress guards."""

    name = "libretv_seed_crawler"
    robots_txt_obey = True
    concurrent_requests = 2
    concurrent_requests_per_domain = 1
    download_delay = 1.0

    def __init__(self, urls: list[str], crawldir: Path | None = None) -> None:
        super().__init__(crawldir=crawldir, interval=60.0)
        self.start_urls = urls
        self.allowed_domains = {
            (urlsplit(url).hostname or "").lower() for url in urls
        }

    async def parse(self, response: Response):
        title = response.css_first("title::text")
        yield {
            "url": str(response.url),
            "status": getattr(response, "status", None),
            "title": title.get("").strip() if title else "",
            "text": response.get_all_text(strip=True)[:20000],
        }


class ScraplingSpiderAdapter:
    """Runs Scrapling Spider through its async streaming API."""

    @staticmethod
    def create(urls: list[str], crawldir: Path | None = None) -> _SeedSpider:
        return _SeedSpider(urls, crawldir=crawldir)

    @staticmethod
    async def crawl_async(
        urls: list[str],
        crawldir: Path | None = None,
    ) -> dict[str, Any]:
        spider = ScraplingSpiderAdapter.create(urls, crawldir)
        items: list[dict[str, Any]] = []
        async for item in spider.stream():
            items.append(item)
        return {
            "items": items,
            "completed": True,
            "paused": False,
            "stats": asdict(spider.stats),
        }

    @staticmethod
    def crawl(urls: list[str], crawldir: Path | None = None) -> dict[str, Any]:
        # Kept for the legacy synchronous endpoint. Unlike Spider.start(), stream()
        # does not install process signal handlers, so it is safe in a worker thread.
        return asyncio.run(ScraplingSpiderAdapter.crawl_async(urls, crawldir))
