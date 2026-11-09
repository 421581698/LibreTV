import hmac
import ipaddress
import os
import socket
import time
from urllib.parse import urljoin, urlparse

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, HttpUrl
from scrapling.fetchers import Fetcher

FMHY_VIDEO_URL = "https://fmhy.net/video"
TOKEN = os.environ.get("SCRAPLING_API_TOKEN", "").strip()
MAX_RESULTS = 100
MIN_HOST_INTERVAL = 2.0
_last_request_by_host: dict[str, float] = {}
_discovered_hosts: set[str] = set()

if not TOKEN:
    raise RuntimeError("SCRAPLING_API_TOKEN must be configured")

app = FastAPI(title="LibreTV FMHY Scrapling Collector", docs_url=None, redoc_url=None)


class CrawlRequest(BaseModel):
    url: HttpUrl
    limit: int = Field(default=50, ge=1, le=MAX_RESULTS)


def require_token(authorization: str | None) -> None:
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not supplied or not hmac.compare_digest(supplied, TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


def public_https_url(raw_url: str) -> tuple[str, str]:
    parsed = urlparse(raw_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Only public HTTPS URLs are allowed")
    host = parsed.hostname.lower().rstrip(".")
    if host == "fmhy.net" or host.endswith(".fmhy.net"):
        return raw_url, host
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    except OSError:
        raise HTTPException(status_code=400, detail="Unable to resolve target host")
    if not addresses:
        raise HTTPException(status_code=400, detail="Target host has no address")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise HTTPException(status_code=400, detail="Private or reserved network targets are blocked")
    return raw_url, host


def throttle(host: str) -> None:
    now = time.monotonic()
    previous = _last_request_by_host.get(host, 0.0)
    wait = MIN_HOST_INTERVAL - (now - previous)
    if wait > 0:
        time.sleep(wait)
    _last_request_by_host[host] = time.monotonic()


def text_of(element) -> str:
    try:
        return " ".join((element.css("::text").getall() or [])).strip()
    except Exception:
        return ""


def discover_sites() -> list[dict]:
    page = Fetcher.get(FMHY_VIDEO_URL, timeout=20)
    sites: list[dict] = []
    seen: set[str] = set()
    for anchor in page.css("a"):
        href = (anchor.attrib.get("href") or "").strip()
        if not href:
            continue
        absolute = urljoin(FMHY_VIDEO_URL, href)
        parsed = urlparse(absolute)
        if parsed.scheme != "https" or not parsed.hostname:
            continue
        host = parsed.hostname.lower().rstrip(".")
        if host == "fmhy.net" or host.endswith(".fmhy.net") or host in seen:
            continue
        try:
            public_https_url(absolute)
        except HTTPException:
            continue
        title = text_of(anchor)[:160]
        if not title:
            continue
        seen.add(host)
        sites.append({"title": title, "url": absolute, "host": host, "directory": "FMHY / Movies-TV-Anime"})
        if len(sites) >= MAX_RESULTS:
            break
    _discovered_hosts.clear()
    _discovered_hosts.update(seen)
    return sites


@app.get("/health")
def health():
    return {"ok": True, "engine": "Scrapling", "directory": "FMHY", "directory_url": FMHY_VIDEO_URL}


@app.get("/v1/discover")
def discover(authorization: str | None = Header(default=None)):
    require_token(authorization)
    try:
        sites = discover_sites()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FMHY directory fetch failed: {type(exc).__name__}")
    return {"directory": FMHY_VIDEO_URL, "count": len(sites), "sites": sites}


@app.post("/v1/crawl")
def crawl(payload: CrawlRequest, authorization: str | None = Header(default=None)):
    require_token(authorization)
    raw_url, host = public_https_url(str(payload.url))
    if host not in _discovered_hosts:
        raise HTTPException(status_code=403, detail="Target host was not discovered from the FMHY video directory")
    throttle(host)
    try:
        page = Fetcher.get(raw_url, timeout=20)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Scrapling fetch failed: {type(exc).__name__}")

    candidates: list[dict] = []
    seen: set[str] = set()
    selectors = [
        ("video source", "src", "embedded-media"),
        ("video", "src", "embedded-media"),
        ("source", "src", "embedded-media"),
        ("iframe", "src", "embedded-player"),
        ("a", "href", "linked-media"),
    ]
    media_extensions = (".m3u8", ".mp4", ".m4v", ".webm", ".mpd", ".mov")
    for selector, attribute, kind in selectors:
        for element in page.css(selector):
            target = (element.attrib.get(attribute) or "").strip()
            if not target:
                continue
            absolute = urljoin(raw_url, target)
            parsed = urlparse(absolute)
            if parsed.scheme != "https" or not parsed.hostname:
                continue
            if kind == "linked-media" and not parsed.path.lower().endswith(media_extensions):
                continue
            if absolute in seen:
                continue
            seen.add(absolute)
            candidates.append({"url": absolute, "kind": kind, "host": parsed.hostname.lower()})
            if len(candidates) >= payload.limit:
                break
        if len(candidates) >= payload.limit:
            break
    return {
        "page_url": raw_url,
        "title": (page.css("title::text").get() or "")[:200],
        "engine": "Scrapling",
        "count": len(candidates),
        "candidates": candidates,
        "note": "Only publicly linked media/player URLs were collected; no login, paywall, DRM or access-control bypass is performed.",
    }
