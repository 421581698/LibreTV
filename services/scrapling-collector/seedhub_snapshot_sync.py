from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from scrapling.fetchers import Fetcher

from seedhub import (
    SEEDHUB_HOST,
    _require_public_seedhub_host,
    parse_catalog_html,
    parse_detail_html,
)

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "data" / "seedhub"
ORIGIN = "https://www.seedhub.cc"
CATEGORIES = {"movies": 1, "series": 3, "anime": 2}
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": ORIGIN + "/",
}
PAGES = 2
DETAIL_LIMIT = 12


def fetch_html(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != SEEDHUB_HOST or parsed.port not in (None, 443):
        raise RuntimeError("Refusing to fetch a URL outside the fixed SeedHub HTTPS origin")
    response = Fetcher.get(url, headers=HEADERS, timeout=25, follow_redirects="safe")
    final = urlparse(str(getattr(response, "url", url)))
    if final.scheme != "https" or final.hostname != SEEDHUB_HOST:
        raise RuntimeError("SeedHub request redirected outside the fixed source origin")
    status = getattr(response, "status", getattr(response, "status_code", 200))
    if isinstance(status, int) and status >= 400:
        raise RuntimeError(f"SeedHub returned HTTP {status}")
    html = getattr(response, "text", None)
    if not isinstance(html, str) or not html:
        html = getattr(response, "html_content", None)
    if not isinstance(html, str) or not html:
        raise RuntimeError("SeedHub returned an empty HTML document")
    if len(html.encode("utf-8")) > 8 * 1024 * 1024:
        raise RuntimeError("SeedHub HTML exceeded the 8 MiB response limit")
    return html


def build_category(category: str, category_id: int, updated_at: str) -> dict:
    collected: dict[str, dict] = {}
    for page in range(1, PAGES + 1):
        page_url = f"{ORIGIN}/categories/{category_id}/movies/" + (f"?page={page}" if page > 1 else "")
        records = parse_catalog_html(fetch_html(page_url), page_url, category)
        for record in records:
            source_url = record.get("source_url", "")
            poster_url = record.get("poster_url")
            if not source_url or not poster_url:
                continue
            parsed_source = urlparse(source_url)
            parsed_poster = urlparse(poster_url)
            if parsed_source.scheme != "https" or parsed_source.hostname != SEEDHUB_HOST:
                continue
            if parsed_poster.scheme != "https" or parsed_poster.hostname not in {
                SEEDHUB_HOST, "img.seedhub.cc", "sh1.pcie.pppoe.top"
            }:
                continue
            collected[source_url] = {
                "source_url": source_url,
                "title": str(record.get("title") or "").strip()[:240],
                "category": category,
                "poster_url": poster_url,
                "discovered_at": int(datetime.now(timezone.utc).timestamp()),
                "detail": None,
            }
        time.sleep(1)

    items = list(collected.values())
    if len(items) < 10:
        raise RuntimeError(f"{category}: expected at least 10 unique records with real posters, got {len(items)}")

    detail_successes = 0
    for item in items[:DETAIL_LIMIT]:
        try:
            detail_html = fetch_html(item["source_url"])
            detail = parse_detail_html(detail_html, item["source_url"], category)
            if detail.get("title") and detail.get("poster_url") and detail.get("still_urls"):
                item["detail"] = detail
                detail_successes += 1
        except Exception as exc:
            print(f"DETAIL_SKIP category={category} type={type(exc).__name__}", flush=True)
        time.sleep(0.5)

    if detail_successes == 0:
        raise RuntimeError(f"{category}: no detail page passed metadata and still-image extraction")

    return {
        "source": "SeedHub",
        "category": category,
        "updated_at": updated_at,
        "total": len(items),
        "pages": PAGES,
        "detail_enriched": detail_successes,
        "items": items,
    }


def main() -> int:
    _require_public_seedhub_host()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    results = {}
    for category, category_id in CATEGORIES.items():
        snapshot = build_category(category, category_id, updated_at)
        target = OUTPUT / f"{category}.json"
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        temporary.replace(target)
        results[category] = snapshot
        print(
            f"SEEDHUB_SNAPSHOT category={category} total={snapshot['total']} "
            f"details={snapshot['detail_enriched']} updated_at={updated_at}",
            flush=True,
        )
        time.sleep(1)

    print("SEEDHUB_SNAPSHOT_OK " + " ".join(
        f"{category}={payload['total']}" for category, payload in results.items()
    ), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"SEEDHUB_SNAPSHOT_FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
