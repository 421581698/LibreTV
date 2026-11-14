from __future__ import annotations

import sys
import time
from urllib.parse import urlparse

from scrapling.fetchers import Fetcher

from seedhub import parse_catalog_html, parse_detail_html

ORIGIN = "https://www.seedhub.cc"
CATEGORY_PATHS = {"movies": 1, "series": 3, "anime": 2}
DETAIL_SAMPLE = ORIGIN + "/movies/130096/"


def fetch_html(url: str) -> str:
    response = Fetcher.get(url, timeout=25, follow_redirects="safe")
    final_url = urlparse(str(getattr(response, "url", url)))
    if final_url.scheme != "https" or final_url.hostname != "www.seedhub.cc":
        raise RuntimeError(f"Unexpected redirect while reading fixed SeedHub URL: {url}")
    status = getattr(response, "status", getattr(response, "status_code", 200))
    if isinstance(status, int) and status >= 400:
        raise RuntimeError(f"SeedHub returned HTTP {status} for {url}")
    html = getattr(response, "text", None)
    if not isinstance(html, str) or not html:
        html = getattr(response, "html_content", None)
    if not isinstance(html, str) or not html:
        raise RuntimeError(f"SeedHub returned an empty HTML document for {url}")
    return html


def main() -> int:
    totals: dict[str, int] = {}
    for category, category_id in CATEGORY_PATHS.items():
        # SeedHub currently exposes the three public catalogues under these fixed paths.
        url = f"{ORIGIN}/categories/{category_id}/movies/"
        html = fetch_html(url)
        items = parse_catalog_html(html, url, category)
        if len(items) < 10:
            raise RuntimeError(f"{category}: expected at least 10 catalogue records, got {len(items)}")
        expected_prefix = f"/{category}/"
        if any(not urlparse(item["source_url"]).path.startswith(expected_prefix) for item in items):
            raise RuntimeError(f"{category}: parser returned a detail URL outside its category")
        unique_urls = {item["source_url"] for item in items}
        if len(unique_urls) != len(items):
            raise RuntimeError(f"{category}: duplicate detail URLs in one catalogue page")
        posters = sum(bool(item.get("poster_url")) for item in items)
        if posters == 0:
            raise RuntimeError(f"{category}: no real poster URLs were extracted")
        totals[category] = len(items)
        print(f"PASS catalogue {category}: {len(items)} records, {posters} poster URLs, unique detail URLs")
        time.sleep(1)

    detail_html = fetch_html(DETAIL_SAMPLE)
    detail = parse_detail_html(detail_html, DETAIL_SAMPLE)
    if "生化危机" not in detail.get("title", ""):
        raise RuntimeError("Detail sample title did not match the expected SeedHub page")
    if not detail.get("description"):
        raise RuntimeError("Detail sample has no extracted synopsis")
    if not detail.get("poster_url"):
        raise RuntimeError("Detail sample has no extracted poster")
    if not detail.get("still_urls"):
        raise RuntimeError("Detail sample has no extracted still images")
    if detail.get("external_resource_links_extracted") is not False:
        raise RuntimeError("The live probe must never extract external share/download links")
    print(
        "PASS detail sample: "
        f"title={detail['title']!r}, poster=yes, stills={len(detail['still_urls'])}, "
        "metadata_only=yes, external_share_links=not_extracted"
    )
    print("SEEDHUB_LIVE_SMOKE_OK " + " ".join(f"{key}={value}" for key, value in totals.items()))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"SEEDHUB_LIVE_SMOKE_FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
