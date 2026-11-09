from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.spider import ScraplingSpiderAdapter


@dataclass
class FakeStats:
    requests_count: int = 1


class FakeSpider:
    def __init__(self, urls, crawldir=None) -> None:
        self.urls = urls
        self.crawldir = crawldir
        self.stats = FakeStats()

    async def stream(self):
        yield {"url": self.urls[0], "title": "streamed fixture"}


def test_spider_adapter_uses_async_stream_without_signal_start(monkeypatch) -> None:
    monkeypatch.setattr("app.spider._SeedSpider", FakeSpider)

    result = asyncio.run(
        ScraplingSpiderAdapter.crawl_async(
            ["https://example.com/"],
        )
    )

    assert result["completed"] is True
    assert result["paused"] is False
    assert result["items"] == [
        {"url": "https://example.com/", "title": "streamed fixture"}
    ]
    assert result["stats"]["requests_count"] == 1
