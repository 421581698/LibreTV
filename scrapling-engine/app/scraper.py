from __future__ import annotations

from typing import Any

from scrapling.fetchers import Fetcher


class ScraplingAdapter:
    """Thin adapter around upstream Scrapling; extraction stays framework-native."""

    @staticmethod
    def fetch_page(url: str, timeout: float = 25.0) -> Any:
        # Fetcher is the low-cost HTTP path. Dynamic/stealth browser modes are
        # exposed only after their browser runtime is installed and verified.
        return Fetcher.get(url, timeout=timeout)

    @staticmethod
    def extract(page: Any, selector: str | None = None) -> dict[str, Any]:
        if selector:
            elements = page.css(selector)
            text = [element.get_all_text(strip=True) for element in elements]
        else:
            text = [page.get_all_text(strip=True)]
        return {
            "status": getattr(page, "status", None),
            "url": getattr(page, "url", None),
            "title": page.css_first("title::text").get()
            if page.css_first("title::text") else None,
            "text": text,
            "count": len(text),
        }
