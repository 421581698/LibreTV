from __future__ import annotations

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

    def __init__(self, urls: list[str]) -> None:
        super().__init__()
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
    """Runs the upstream Spider engine with conservative LibreTV defaults."""

    @staticmethod
    def crawl(urls: list[str]) -> dict[str, Any]:
        result = _SeedSpider(urls).start()
        return {
            "items": list(result.items),
            "completed": result.completed,
            "paused": result.paused,
            "stats": result.stats.to_dict(),
        }
