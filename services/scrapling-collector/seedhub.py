from __future__ import annotations

import os
import re
import sqlite3
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

from fastapi import APIRouter, Header, HTTPException, Query
from scrapling.fetchers import Fetcher

SEEDHUB_ORIGIN = "https://www.seedhub.cc"
SEEDHUB_HOST = "www.seedhub.cc"
DB_PATH = Path(os.environ.get("SCRAPLING_DB_PATH", "/data/collector.sqlite3"))
TOKEN = os.environ.get("SCRAPLING_API_TOKEN", "").strip()
router = APIRouter()


class _CatalogParser(HTMLParser):
    """Extract public catalogue metadata only; never follows or extracts share/download URLs."""

    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.items: list[dict] = []
        self.current: dict | None = None
        self.anchor_depth = 0

    def handle_starttag(self, tag: str, attrs):
        values = dict(attrs)
        if tag == "a":
            href = values.get("href", "")
            parsed = urlparse(urljoin(self.base_url, href))
            if parsed.scheme == "https" and parsed.hostname == SEEDHUB_HOST and re.match(r"^/(?:movies|series|anime)/[^/?#]+/?$", parsed.path):
                self.current = {"source_url": parsed._replace(query="", fragment="").geturl(), "title": "", "poster_url": None}
                self.anchor_depth = 1
            elif self.current is not None:
                self.anchor_depth += 1
        elif tag == "img" and self.current is not None:
            raw = values.get("data-src") or values.get("data-original") or values.get("src") or ""
            image_url = urljoin(self.base_url, raw)
            image = urlparse(image_url)
            if image.scheme == "https" and image.hostname in {SEEDHUB_HOST, "img.seedhub.cc"}:
                self.current["poster_url"] = image_url
        elif tag == "br" and self.current is not None:
            self.current["title"] += " "

    def handle_data(self, data):
        if self.current is not None:
            self.current["title"] += data

    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            self.anchor_depth -= 1
            if self.anchor_depth <= 0:
                title = re.sub(r"\s+", " ", self.current["title"]).strip()[:240]
                if title and not any(item["source_url"] == self.current["source_url"] for item in self.items):
                    self.current["title"] = title
                    self.items.append(self.current)
                self.current = None


def parse_catalog_html(html: str, page_url: str, category: str = "movies") -> list[dict]:
    parsed = urlparse(page_url)
    if parsed.scheme != "https" or parsed.hostname != SEEDHUB_HOST:
        raise ValueError("SeedHub page URL is outside the fixed source origin")
    if category not in {"movies", "series", "anime"}:
        raise ValueError("Unsupported SeedHub category")
    parser = _CatalogParser(page_url)
    parser.feed(html)
    return [{**item, "category": category, "source_name": "SeedHub"} for item in parser.items]


def _connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _initialize():
    with _connect() as conn:
        conn.execute("""
          CREATE TABLE IF NOT EXISTS seedhub_catalog (
            source_url TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
            poster_url TEXT, discovered_at INTEGER NOT NULL
          )
        """)


def _require_auth(authorization: str | None):
    import hmac
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not TOKEN or not hmac.compare_digest(supplied, TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _require_egress_firewall():
    if os.environ.get("SCRAPLING_EGRESS_FIREWALL_CONFIRMED", "").strip() != "1":
        raise HTTPException(status_code=503, detail="SeedHub crawling is disabled until host-level egress filtering is verified")


def _catalog_path(category: str, page: int) -> str:
    category_id = {"movies": 1, "series": 3, "anime": 2}[category]
    section = "movies"
    suffix = "" if page == 1 else f"?page={page}"
    return f"/categories/{category_id}/{section}/{suffix}"


@router.post("/v1/seedhub/sync")
def sync_seedhub(
    category: str = Query(default="movies", pattern="^(movies|series|anime)$"),
    pages: int = Query(default=1, ge=1, le=5),
    authorization: str | None = Header(default=None),
):
    _require_auth(authorization)
    _require_egress_firewall()
    _initialize()
    collected = 0
    failures = []
    for page_number in range(1, pages + 1):
        page_url = SEEDHUB_ORIGIN + _catalog_path(category, page_number)
        try:
            response = Fetcher.get(page_url, timeout=25, follow_redirects="safe")
            final_url = str(getattr(response, "url", page_url))
            final = urlparse(final_url)
            if final.scheme != "https" or final.hostname != SEEDHUB_HOST:
                raise ValueError("Unexpected redirect outside SeedHub origin")
            html = getattr(response, "text", None)\n            if not isinstance(html, str) or not html:\n                html = getattr(response, "html_content", None)\n            if not isinstance(html, str) or not html:\n                raise ValueError("SeedHub returned an empty HTML document")\n            records = parse_catalog_html(html, page_url, category)
            now = int(time.time())
            with _connect() as conn:
                for item in records:
                    conn.execute(
                        """INSERT INTO seedhub_catalog(source_url,title,category,poster_url,discovered_at)
                           VALUES(?,?,?,?,?) ON CONFLICT(source_url) DO UPDATE SET
                           title=excluded.title,category=excluded.category,
                           poster_url=COALESCE(excluded.poster_url,seedhub_catalog.poster_url),
                           discovered_at=excluded.discovered_at""",
                        (item["source_url"], item["title"], item["category"], item["poster_url"], now),
                    )
            collected += len(records)
        except Exception as exc:
            failures.append({"page": page_number, "error": type(exc).__name__})
    with _connect() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM seedhub_catalog WHERE category=?", (category,)).fetchone()["n"]
    return {"source": "SeedHub", "category": category, "pages_requested": pages,
            "records_seen": collected, "records_indexed": total, "failures": failures,
            "mode": "metadata-only", "share_links_extracted": False}


@router.get("/v1/seedhub/catalog")
def seedhub_catalog(
    category: str = Query(default="movies", pattern="^(movies|series|anime)$"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1000000),
    authorization: str | None = Header(default=None),
):
    _require_auth(authorization)
    _initialize()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT source_url,title,category,poster_url,discovered_at FROM seedhub_catalog WHERE category=? ORDER BY discovered_at DESC LIMIT ? OFFSET ?",
            (category, limit, offset),
        ).fetchall()
        total = conn.execute("SELECT COUNT(*) AS n FROM seedhub_catalog WHERE category=?", (category,)).fetchone()["n"]
    return {"source": "SeedHub", "category": category, "total": total, "items": [dict(row) for row in rows]}
