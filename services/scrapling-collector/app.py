from __future__ import annotations

import csv
import hashlib
import http.client
import hmac
import ipaddress
import json
import os
import socket
import ssl
import sqlite3
import time
import xml.etree.ElementTree as ET
import uuid
from pathlib import Path
from urllib.parse import urljoin, urlparse

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, HttpUrl
from scrapling.fetchers import Fetcher, StealthySession
from scrapling.spiders import Response, Spider

FMHY_VIDEO_URL = "https://fmhy.net/video"
TOKEN = os.environ.get("SCRAPLING_API_TOKEN", "").strip()
DB_PATH = Path(os.environ.get("SCRAPLING_DB_PATH", "/data/collector.sqlite3"))
MAX_RESULTS = 100
MAX_CANDIDATES = 100
MIN_HOST_INTERVAL = 2.0
MEDIA_EXTENSIONS = (".m3u8", ".mp4", ".m4v", ".webm", ".mpd", ".mov", ".ts", ".m4s", ".aac")
CMS_PATH_MARKERS = ("/api.php/provide/vod", "/provide/vod", "/api/v1/vod")
_last_request_by_host: dict[str, float] = {}

if not TOKEN:
    raise RuntimeError("SCRAPLING_API_TOKEN must be configured")

app = FastAPI(title="LibreTV FMHY Scrapling Collector", docs_url=None, redoc_url=None)

# Scrapling stores adaptive selector fingerprints in its own SQLite storage.
Fetcher.adaptive = True


class CrawlRequest(BaseModel):
    url: HttpUrl
    mode: str = Field(default="auto", pattern="^(auto|http|browser)$")
    limit: int = Field(default=50, ge=1, le=MAX_CANDIDATES)


class CandidateValidation(BaseModel):
    candidate_id: str


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def init_db() -> None:
    with db() as connection:
        connection.executescript("""
        CREATE TABLE IF NOT EXISTS sites (
          host TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL,
          directory TEXT NOT NULL, discovered_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY, url TEXT NOT NULL, host TEXT NOT NULL,
          status TEXT NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL, error TEXT, result_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS candidates (
          id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          url TEXT NOT NULL, host TEXT NOT NULL, kind TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL, validation TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_candidates_task ON candidates(task_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
        """)
        connection.execute("UPDATE tasks SET status='interrupted',updated_at=? WHERE status='running'", (int(time.time()),))


init_db()


def require_token(authorization: str | None) -> None:
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not supplied or not hmac.compare_digest(supplied, TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


def public_https_url(raw_url: str) -> tuple[str, str]:
    parsed = urlparse(raw_url)
    try:
        port = parsed.port
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid target port")
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or port not in (None, 443)
    ):
        raise HTTPException(status_code=400, detail="Only public HTTPS URLs on port 443 are allowed")
    host = parsed.hostname.lower().rstrip(".")
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    except OSError:
        raise HTTPException(status_code=400, detail="Unable to resolve target host")
    if not addresses:
        raise HTTPException(status_code=400, detail="Target host has no address")
    for address in addresses:
        if not ipaddress.ip_address(address).is_global:
            raise HTTPException(status_code=400, detail="Private or reserved network targets are blocked")
    return raw_url, host


MAX_MANIFEST_BYTES = 1024 * 1024


def parse_hls_manifest(body: bytes) -> dict:
    text = body.decode("utf-8-sig", errors="replace")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines or lines[0] != "#EXTM3U":
        return {"manifest_valid": False, "manifest_error": "missing_extm3u"}
    variants: list[dict] = []
    segment_uris: list[str] = []
    segment_count = 0
    durations: list[float] = []
    pending_variant: dict | None = None
    encryption_methods: set[str] = set()
    key_uri_present = False
    for line in lines[1:]:
        if line.startswith("#EXT-X-STREAM-INF:"):
            attrs = {}
            raw_attrs = line.split(":", 1)[1]
            try:
                parts = next(csv.reader([raw_attrs], skipinitialspace=True))
            except (csv.Error, StopIteration):
                parts = raw_attrs.split(",")
            for part in parts:
                if "=" in part:
                    key, value = part.split("=", 1)
                    attrs[key.strip().upper()] = value.strip().strip('"')
            resolution = attrs.get("RESOLUTION", "")
            width = height = None
            if "x" in resolution.lower():
                try:
                    width, height = (int(v) for v in resolution.lower().split("x", 1))
                except ValueError:
                    pass
            pending_variant = {
                "bandwidth": int(attrs["BANDWIDTH"]) if attrs.get("BANDWIDTH", "").isdigit() else None,
                "average_bandwidth": int(attrs["AVERAGE-BANDWIDTH"]) if attrs.get("AVERAGE-BANDWIDTH", "").isdigit() else None,
                "width": width,
                "height": height,
                "codecs": attrs.get("CODECS"),
            }
        elif line.startswith("#EXT-X-KEY:"):
            attrs = {}
            raw_attrs = line.split(":", 1)[1]
            try:
                parts = next(csv.reader([raw_attrs], skipinitialspace=True))
            except (csv.Error, StopIteration):
                parts = raw_attrs.split(",")
            for part in parts:
                if "=" in part:
                    key, value = part.split("=", 1)
                    attrs[key.strip().upper()] = value.strip().strip('"')
            method = attrs.get("METHOD", "UNKNOWN")
            encryption_methods.add(method)
            key_uri_present = key_uri_present or "URI" in attrs
            # Deliberately do not retain or fetch key URI values.
        elif line.startswith("#EXTINF:"):
            try:
                durations.append(float(line.split(":", 1)[1].split(",", 1)[0]))
            except ValueError:
                pass
        elif not line.startswith("#"):
            if pending_variant is not None:
                pending_variant["uri"] = line
                variants.append(pending_variant)
                pending_variant = None
            else:
                segment_count += 1
                if len(segment_uris) < 50:
                    segment_uris.append(line)
    return {
        "manifest_valid": True,
        "manifest_type": "hls",
        "is_master_playlist": bool(variants),
        "variant_count": len(variants),
        "variants": variants[:20],
        "segment_count": segment_count,
        "segment_uris": segment_uris,
        "duration_seconds": round(sum(durations), 3) if durations else None,
        "encrypted": bool(encryption_methods - {"NONE"}),
        "encryption_methods": sorted(encryption_methods),
        "key_uri_present": key_uri_present,
    }


def parse_mpd_manifest(body: bytes) -> dict:
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return {"manifest_valid": False, "manifest_error": "invalid_xml"}
    if root.tag.split("}")[-1] != "MPD":
        return {"manifest_valid": False, "manifest_error": "missing_mpd_root"}
    representations = []
    for node in root.iter():
        if node.tag.split("}")[-1] != "Representation":
            continue
        try:
            width = int(node.attrib["width"]) if node.attrib.get("width") else None
            height = int(node.attrib["height"]) if node.attrib.get("height") else None
            bandwidth = int(node.attrib["bandwidth"]) if node.attrib.get("bandwidth") else None
        except ValueError:
            width = height = bandwidth = None
        representations.append({
            "id": node.attrib.get("id"),
            "width": width,
            "height": height,
            "bandwidth": bandwidth,
            "codecs": node.attrib.get("codecs"),
        })
    return {
        "manifest_valid": True,
        "manifest_type": "dash",
        "dynamic": root.attrib.get("type", "static").lower() == "dynamic",
        "representation_count": len(representations),
        "representations": representations[:20],
    }


def validate_manifest_references(manifest: dict, base_url: str) -> dict:
    """Resolve and DNS-check HLS variant/segment URLs; never retain key URLs."""
    dns_cache: dict[str, bool] = {}
    rejected = 0

    def safe_reference(reference: str) -> str | None:
        nonlocal rejected
        absolute = urljoin(base_url, reference)
        try:
            _, host = public_https_url(absolute)
        except HTTPException:
            rejected += 1
            return None
        if host not in dns_cache:
            dns_cache[host] = True
        return absolute if dns_cache[host] else None

    safe_variants = []
    for variant in manifest.get("variants", []):
        item = dict(variant)
        uri = item.get("uri")
        resolved = safe_reference(uri) if isinstance(uri, str) else None
        if resolved:
            item["uri"] = resolved
            safe_variants.append(item)
    safe_segments = []
    for uri in manifest.get("segment_uris", []):
        resolved = safe_reference(uri)
        if resolved:
            safe_segments.append(resolved)
    result = dict(manifest)
    if "variants" in result:
        result["variants"] = safe_variants
        result["variant_count"] = len(safe_variants)
    if "segment_uris" in result:
        result["segment_uris"] = safe_segments
        result["segment_count"] = len(safe_segments)
    result["rejected_reference_count"] = rejected
    result["safe_reference_count"] = len(safe_variants) + len(safe_segments)
    return result


def probe_direct_media(raw_url: str, max_redirects: int = 5) -> dict:
    """Probe media headers with a one-byte range request and safe manual redirects."""
    current = raw_url
    for redirect_count in range(max_redirects + 1):
        try:
            normalized, host = public_https_url(current)
        except HTTPException:
            return {"reachable": False, "error": "unsafe_or_invalid_redirect_target"}
        parsed = urlparse(normalized)
        target = parsed.path or "/"
        if parsed.query:
            target += "?" + parsed.query
        connection = http.client.HTTPSConnection(
            host, 443, timeout=10, context=ssl.create_default_context()
        )
        try:
            request_headers = {
                "Accept": "*/*",
                "User-Agent": "LibreTV-Resource-Validator/1.0",
                "Connection": "close",
            }
            # Do not Range-truncate manifests: the parser needs the complete
            # bounded playlist/MPD document. Progressive files use a one-byte probe.
            if not parsed.path.lower().endswith((".m3u8", ".mpd")):
                request_headers["Range"] = "bytes=0-0"
            connection.request("GET", target, headers=request_headers)
            response = connection.getresponse()
            status = response.status
            headers = {key.lower(): value for key, value in response.getheaders()}
            if status in (301, 302, 303, 307, 308):
                location = headers.get("location")
                response.close()
                if not location or redirect_count >= max_redirects:
                    return {"reachable": False, "http_status": status, "error": "redirect_limit_or_missing_location"}
                current = urljoin(normalized, location)
                continue
            content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
            path = urlparse(normalized).path.lower()
            is_hls = path.endswith(".m3u8") or content_type in {
                "application/vnd.apple.mpegurl", "application/x-mpegurl"
            }
            is_dash = path.endswith(".mpd") or content_type == "application/dash+xml"
            is_video = content_type.startswith("video/") or path.endswith((".mp4", ".m4v", ".webm", ".mov", ".ts", ".m4s", ".aac"))
            media_type = is_hls or is_dash or is_video
            manifest = {}
            if 200 <= status < 300 and (is_hls or is_dash):
                body = response.read(MAX_MANIFEST_BYTES + 1)
                if len(body) > MAX_MANIFEST_BYTES:
                    manifest = {"manifest_valid": False, "manifest_error": "manifest_too_large"}
                elif is_hls:
                    manifest = parse_hls_manifest(body)
                    if manifest.get("manifest_valid"):
                        manifest = validate_manifest_references(manifest, normalized)
                else:
                    manifest = parse_mpd_manifest(body)
            response.close()
            reachable = 200 <= status < 300 and media_type
            manifest_valid = manifest.get("manifest_valid") if manifest else None
            if manifest_valid is False:
                reachable = False
            return {
                "reachable": bool(reachable),
                "http_status": status,
                "content_type": content_type or None,
                "content_length": headers.get("content-length"),
                "range_supported": status == 206,
                "final_url": normalized,
                "media_format": "hls" if is_hls else ("dash" if is_dash else ("progressive" if is_video else None)),
                **manifest,
                "note": "Manifest/header validation only; segment delivery and actual playback must still be tested in PlayerShell.",
            }
        except (OSError, http.client.HTTPException, ssl.SSLError) as exc:
            return {"reachable": False, "error": type(exc).__name__}
        finally:
            connection.close()
    return {"reachable": False, "error": "redirect_limit_exceeded"}


def probe_hls_segments(segment_urls: list[str], max_segments: int = 3) -> dict:
    """Probe a tiny sample of HLS media segments without downloading their bodies."""
    sample = segment_urls[:max_segments]
    results = []
    for url in sample:
        try:
            _, host = public_https_url(url)
            throttle(host)
            result = probe_direct_media(url)
            results.append({
                "reachable": bool(result.get("reachable")),
                "http_status": result.get("http_status"),
                "content_type": result.get("content_type"),
            })
        except HTTPException:
            results.append({"reachable": False, "error": "unsafe_segment_url"})
    return {
        "sampled": len(results),
        "reachable": sum(1 for item in results if item.get("reachable")),
        "failed": sum(1 for item in results if not item.get("reachable")),
        "results": results,
        "note": "Only a small sample is probed with byte-range requests; this is not a full playback test.",
    }


def throttle(host: str) -> None:
    now = time.monotonic()
    previous = _last_request_by_host.get(host, 0.0)
    wait = MIN_HOST_INTERVAL - (now - previous)
    if wait > 0:
        time.sleep(wait)
    _last_request_by_host[host] = time.monotonic()


def adaptive_css(page, selector: str):
    """Persist stable element traits per domain and relocate them after markup changes."""
    try:
        elements = page.css(selector, auto_save=True)
        if elements:
            return elements
        return page.css(selector, adaptive=True)
    except Exception:
        try:
            return page.css(selector)
        except Exception:
            return []


def text_of(element) -> str:
    try:
        return " ".join(element.css("::text").getall() or []).strip()
    except Exception:
        return ""


def fmhy_sites_from_page(page) -> list[dict]:
    sites: list[dict] = []
    seen: set[str] = set()
    for anchor in adaptive_css(page, "a"):
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
        title = text_of(anchor)[:160]
        if not title:
            continue
        seen.add(host)
        sites.append({"title": title, "url": absolute, "host": host, "directory": "FMHY / Movies-TV-Anime"})
        if len(sites) >= MAX_RESULTS:
            break
    return sites


def discover_sites() -> list[dict]:
    throttle("fmhy.net")
    page = Fetcher.get(FMHY_VIDEO_URL, timeout=25, follow_redirects="safe")
    sites = fmhy_sites_from_page(page)
    now = int(time.time())
    with db() as connection:
        for site in sites:
            connection.execute(
                """INSERT INTO sites(host,title,url,directory,discovered_at) VALUES(?,?,?,?,?)
                   ON CONFLICT(host) DO UPDATE SET title=excluded.title,url=excluded.url,
                   directory=excluded.directory,discovered_at=excluded.discovered_at""",
                (site["host"], site["title"], site["url"], site["directory"], now),
            )
    return sites


def classify_url(raw_url: str) -> tuple[str, str] | None:
    parsed = urlparse(raw_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return None
    path = parsed.path.lower()
    if path.endswith(MEDIA_EXTENSIONS):
        return "direct-media", parsed.hostname.lower()
    if any(marker in path for marker in CMS_PATH_MARKERS):
        return "cms-api-candidate", parsed.hostname.lower()
    if any(marker in path for marker in ("/embed/", "/player/", "/watch/")):
        return "embedded-player", parsed.hostname.lower()
    return None


def extract_candidates(page, page_url: str, limit: int) -> list[dict]:
    found: dict[str, dict] = {}
    title = (page.css("title::text").get() or "").strip()[:200]
    selectors = [("video", "src"), ("source", "src"), ("iframe", "src"), ("a", "href"), ("script", "src")]
    for selector, attribute in selectors:
        for element in adaptive_css(page, selector):
            value = (element.attrib.get(attribute) or "").strip()
            if not value:
                continue
            absolute = urljoin(page_url, value)
            classified = classify_url(absolute)
            if not classified:
                continue
            kind, host = classified
            found.setdefault(absolute, {"url": absolute, "kind": kind, "host": host, "title": title})
            if len(found) >= limit:
                return list(found.values())
    # Public metadata and common player configuration attributes.
    for element in adaptive_css(page, "[data-src], [data-url], [data-play], [content]"):
        for attribute in ("data-src", "data-url", "data-play", "content"):
            value = (element.attrib.get(attribute) or "").strip()
            if not value.startswith("https://"):
                continue
            classified = classify_url(value)
            if classified:
                kind, host = classified
                found.setdefault(value, {"url": value, "kind": kind, "host": host, "title": title})
    return list(found.values())[:limit]


def captured_api_candidates(session, page_url: str, limit: int) -> list[dict]:
    results: list[dict] = []
    seen: set[str] = set()
    try:
        responses = session.network.search(limit=None)
    except Exception:
        return results
    for response in responses:
        url = getattr(response, "url", "")
        if not url or url in seen:
            continue
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname:
            continue
        content_type = ""
        try:
            content_type = str(response.headers.get("content-type", "")).lower()
        except Exception:
            pass
        kind = "public-api-response" if ("json" in content_type or "xml" in content_type) else None
        classified = classify_url(url)
        if classified:
            kind = classified[0]
        if kind == "public-api-response":
            try:
                body = response.body
                payload = json.loads(body.decode("utf-8", errors="replace")) if isinstance(body, bytes) else json.loads(str(body))
                data = payload.get("data") if isinstance(payload, dict) else None
                api_list = payload.get("list") if isinstance(payload, dict) else None
                if not isinstance(api_list, list) and isinstance(data, dict):
                    api_list = data.get("list")
                if isinstance(api_list, list):
                    kind = "cms-api-candidate"
            except Exception:
                pass
        if kind:
            seen.add(url)
            results.append({"url": url, "kind": kind, "host": parsed.hostname.lower(), "title": "Captured browser network request"})
            if len(results) >= limit:
                break
    return results


class SiteSpider(Spider):
    name = "libretv-fmhy-site"
    start_urls: list[str] = []
    allowed_domains: list[str] = []
    concurrent_requests = 1
    robots_txt_obey = True
    download_delay = 2

    async def parse(self, response: Response):
        title = (response.css("title::text").get() or "").strip()[:200]
        seen: set[str] = set()
        for selector, attribute in (("video", "src"), ("source", "src"), ("iframe", "src"), ("a", "href"), ("script", "src")):
            for element in adaptive_css(response, selector):
                value = (element.attrib.get(attribute) or "").strip()
                absolute = urljoin(response.url, value)
                classified = classify_url(absolute)
                if not classified or absolute in seen:
                    continue
                seen.add(absolute)
                kind, host = classified
                yield {"url": absolute, "kind": kind, "host": host, "title": title}


def run_spider(url: str, limit: int) -> list[dict]:
    class TargetSiteSpider(SiteSpider):
        start_urls = [url]
        allowed_domains = [urlparse(url).hostname]
        followed_urls: set[str] = set()

        async def parse(self, response: Response):
            async for item in super().parse(response):
                yield item
            # Crawl a small same-host sample so directory pages can lead to
            # catalogue/API pages without turning one click into an open crawl.
            for anchor in response.css("a"):
                href = (anchor.attrib.get("href") or "").strip()
                target = urljoin(response.url, href)
                parsed = urlparse(target)
                if parsed.scheme != "https" or parsed.hostname != self.allowed_domains[0]:
                    continue
                if target in self.followed_urls or len(self.followed_urls) >= 8:
                    continue
                self.followed_urls.add(target)
                yield response.follow(target)
    result = TargetSiteSpider(crawldir=str(DB_PATH.parent / "crawls" / hashlib.sha256(url.encode()).hexdigest()[:16])).start()
    candidates: list[dict] = []
    seen: set[str] = set()
    for item in result.items:
        target = item.get("url")
        if target and target not in seen:
            seen.add(target)
            candidates.append(item)
        if len(candidates) >= limit:
            break
    return candidates


def install_browser_request_guard(page) -> None:
    """Reject browser requests that could reach non-public or non-HTTPS targets.

    This is a per-request defense-in-depth check. Deployment-level egress
    filtering is still required to eliminate DNS-rebinding/TOCTOU risk.
    """
    def guard(route) -> None:
        raw_url = route.request.url
        try:
            parsed = urlparse(raw_url)
            port = parsed.port
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or port not in (None, 443)
            ):
                route.abort()
                return
            host = parsed.hostname.lower().rstrip(".")
            addresses = {
                entry[4][0]
                for entry in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            }
            if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
                route.abort()
                return
        except (OSError, ValueError):
            route.abort()
            return
        route.continue_()

    page.route("**/*", guard)


def run_browser_capture(url: str, limit: int) -> tuple[object, list[dict]]:
    # Browser rendering is a fallback for JavaScript-heavy pages. No CAPTCHA,
    # login, paywall, DRM or access-control bypass is attempted.
    with StealthySession(headless=True, record_requests=True, max_recorded_requests=300) as session:
        page = session.fetch(url, timeout=30, network_idle=True, page_setup=install_browser_request_guard)
        candidates = extract_candidates(page, url, limit)
        candidates.extend(captured_api_candidates(session, url, limit - len(candidates)))
        return page, candidates[:limit]


def persist_task(task_id: str, url: str, host: str, mode: str, status: str, error: str | None = None, count: int = 0) -> None:
    with db() as connection:
        connection.execute(
            "UPDATE tasks SET status=?,updated_at=?,error=?,result_count=? WHERE id=?",
            (status, int(time.time()), error, count, task_id),
        )


def crawl_site(payload: CrawlRequest) -> dict:
    raw_url, host = public_https_url(str(payload.url))
    with db() as connection:
        site = connection.execute("SELECT host FROM sites WHERE host=?", (host,)).fetchone()
    if not site:
        raise HTTPException(status_code=403, detail="Target host was not discovered from the FMHY video directory")

    task_id = uuid.uuid4().hex
    now = int(time.time())
    with db() as connection:
        connection.execute(
            "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            (task_id, raw_url, host, "running", payload.mode, now, now),
        )

    try:
        throttle(host)
        candidates: list[dict] = []
        errors: list[str] = []
        if payload.mode in ("auto", "http"):
            try:
                candidates = run_spider(raw_url, payload.limit)
            except Exception as exc:
                errors.append(f"Spider: {type(exc).__name__}")
        if payload.mode == "browser" or (payload.mode == "auto" and not candidates):
            try:
                _, browser_candidates = run_browser_capture(raw_url, payload.limit)
                known = {item["url"] for item in candidates}
                candidates.extend(item for item in browser_candidates if item["url"] not in known)
            except Exception as exc:
                errors.append(f"Browser: {type(exc).__name__}")

        now = int(time.time())
        with db() as connection:
            for item in candidates[:payload.limit]:
                candidate_id = hashlib.sha256((task_id + item["url"]).encode()).hexdigest()[:32]
                connection.execute(
                    """INSERT OR IGNORE INTO candidates
                    (id,task_id,url,host,kind,title,status,created_at)
                    VALUES(?,?,?,?,?,?,?,?)""",
                    (candidate_id, task_id, item["url"], item["host"], item["kind"], item.get("title", ""), "pending", now),
                )
                item["id"] = candidate_id
                item["status"] = "pending"
            connection.execute(
                "UPDATE tasks SET status=?,updated_at=?,error=?,result_count=? WHERE id=?",
                ("partial" if errors and candidates else ("failed" if errors else "completed"), now, "; ".join(errors) or None, len(candidates), task_id),
            )
        task_status = "partial" if errors and candidates else ("failed" if errors else "completed")
        return {"task_id": task_id, "status": task_status,
                "page_url": raw_url, "engine": "Scrapling Spider + StealthySession", "count": len(candidates),
                "candidates": candidates[:payload.limit], "errors": errors,
                "note": "Collected public candidates only. Candidates are not yet trusted playback sources and require validation/approval."}
    except Exception as exc:
        persist_task(task_id, raw_url, host, payload.mode, "failed", type(exc).__name__)
        raise HTTPException(status_code=502, detail=f"Scrapling crawl failed: {type(exc).__name__}")


@app.get("/health")
def health():
    with db() as connection:
        tasks = connection.execute("SELECT COUNT(*) AS n FROM tasks").fetchone()["n"]
    return {"ok": True, "engine": "Scrapling", "directory": "FMHY", "directory_url": FMHY_VIDEO_URL, "stored_tasks": tasks}


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
    return crawl_site(payload)


@app.get("/v1/tasks")
def tasks(authorization: str | None = Header(default=None), limit: int = 50):
    require_token(authorization)
    limit = max(1, min(limit, 100))
    with db() as connection:
        rows = connection.execute("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return {"tasks": [dict(row) for row in rows]}


@app.post("/v1/tasks/{task_id}/retry")
def retry_task(task_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    with db() as connection:
        row = connection.execute("SELECT url,mode,status FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    if row["status"] not in ("failed", "interrupted", "partial"):
        raise HTTPException(status_code=409, detail="Only failed, interrupted or partial tasks can be retried")
    return crawl_site(CrawlRequest(url=row["url"], mode=row["mode"], limit=MAX_CANDIDATES))


@app.get("/v1/tasks/{task_id}/candidates")
def task_candidates(task_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    with db() as connection:
        exists = connection.execute("SELECT id FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Task not found")
        rows = connection.execute("SELECT * FROM candidates WHERE task_id=? ORDER BY created_at DESC", (task_id,)).fetchall()
    return {"candidates": [dict(row) for row in rows]}


@app.post("/v1/candidates/{candidate_id}/validate")
def validate_candidate(candidate_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    with db() as connection:
        row = connection.execute("SELECT * FROM candidates WHERE id=?", (candidate_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Candidate not found")
    candidate = dict(row)
    raw_url, host = public_https_url(candidate["url"])
    validation = {"https": True, "public_host": True, "kind": candidate["kind"],
                  "importable_as_cms_source": candidate["kind"] == "cms-api-candidate",
                  "note": "Direct media/player URLs are playback candidates, not CMS API source definitions."}
    candidate_status = "review"
    if candidate["kind"] == "cms-api-candidate":
        throttle(host)
        try:
            page = Fetcher.get(raw_url, timeout=20, follow_redirects="safe")
            content_type = str(page.headers.get("content-type", "")).lower()
            body = page.body
            parsed = json.loads(body.decode("utf-8", errors="replace"))
            data = parsed.get("data") if isinstance(parsed, dict) else None
            cms_list = parsed.get("list") if isinstance(parsed, dict) else None
            if not isinstance(cms_list, list) and isinstance(data, dict):
                cms_list = data.get("list")
            cms_shape = (
                isinstance(cms_list, list)
                and isinstance(parsed, dict)
                and 200 <= page.status < 300
                and ("json" in content_type or content_type.endswith("+json"))
            )
            validation.update({"reachable": 200 <= page.status < 400, "json": isinstance(parsed, dict),
                               "cms_shape": cms_shape,
                               "sample_count": len(cms_list) if isinstance(cms_list, list) else 0,
                               "content_type": content_type, "http_status": page.status})
            candidate_status = "validated" if cms_shape and isinstance(parsed, dict) else "rejected"
        except Exception as exc:
            validation.update({"reachable": False, "error": type(exc).__name__})
            candidate_status = "rejected"
    elif candidate["kind"] == "direct-media":
        throttle(host)
        probe = probe_direct_media(raw_url)
        validation.update({
            "playback_probe": "range_header_probe",
            **probe,
            "note": "HTTP/media headers were checked with a bounded request. This does not guarantee full playback; verify in PlayerShell.",
        })
        segment_probe = None
        if probe.get("media_format") == "hls" and probe.get("segment_uris"):
            segment_probe = probe_hls_segments(probe["segment_uris"])
            validation["segment_probe"] = segment_probe
        candidate_status = (
            "validated"
            if probe.get("reachable") and (
                not segment_probe or segment_probe.get("sampled", 0) == segment_probe.get("reachable", 0)
            )
            else "rejected"
        )
    else:
        validation.update({
            "reachable": None,
            "playback_probe": "not_performed",
            "note": "Public URL and candidate type were checked. Embedded player content still requires manual playback verification; this is not a CMS API source.",
        })
    with db() as connection:
        connection.execute("UPDATE candidates SET status=?,validation=? WHERE id=?",
                           (candidate_status, json.dumps(validation, ensure_ascii=False), candidate_id))
    return {"candidate_id": candidate_id, "validation": validation}
