from __future__ import annotations

import ipaddress
import re
from urllib.parse import urljoin, urlsplit, urlunsplit
from typing import Any


_MEDIA_SUFFIXES = {
    ".m3u8": "hls",
    ".mp4": "mp4",
    ".mpd": "dash",
    ".webm": "webm",
}
_MEDIA_URL_PATTERN = re.compile(
    r"""https?://[^\s"'<>\\]+?\.(?:m3u8|mp4|mpd|webm)(?:\?[^\s"'<>\\]*)?""",
    re.IGNORECASE,
)
_PAGE_HINTS = re.compile(
    r"(?:movie|film|series|season|episode|anime|watch|detail|play|video)",
    re.IGNORECASE,
)


def _values(page: Any, selector: str) -> list[str]:
    try:
        return [str(value).strip() for value in page.css(selector).getall() if value]
    except (AttributeError, TypeError, ValueError):
        return []


def _first(page: Any, *selectors: str) -> str | None:
    for selector in selectors:
        values = _values(page, selector)
        if values:
            return values[0][:1000]
    return None


def _normalize_candidate(raw_url: str, base_url: str) -> str | None:
    value = raw_url.strip().replace("\\/", "/")
    if not value or value.startswith(("data:", "javascript:", "blob:")):
        return None
    absolute = urljoin(base_url, value)
    try:
        parsed = urlsplit(absolute)
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username is not None or parsed.password is not None or port == 0:
        return None
    host = parsed.hostname.rstrip(".").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".localhost"):
        return None
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        return None
    scheme = parsed.scheme.lower()
    default_port = 443 if scheme == "https" else 80
    authority_host = f"[{host}]" if isinstance(address, ipaddress.IPv6Address) else host
    authority = authority_host if port is None or port == default_port else f"{authority_host}:{port}"
    return urlunsplit((scheme, authority, parsed.path or "/", parsed.query, ""))


def _media_type(url: str, declared_type: str | None = None) -> str | None:
    if declared_type:
        normalized = declared_type.lower()
        if "mpegurl" in normalized or "m3u8" in normalized:
            return "hls"
        if "dash+xml" in normalized:
            return "dash"
        if normalized.startswith("video/"):
            return "video"
    path = urlsplit(url).path.lower()
    return next((kind for suffix, kind in _MEDIA_SUFFIXES.items() if path.endswith(suffix)), None)


def extract_page_signals(page: Any, page_url: str) -> dict[str, Any]:
    """Extract public page metadata, same-host navigation links and media candidates.

    This is discovery only. Candidate hosts must be DNS/egress-validated again
    immediately before any later fetch, and media must pass independent playback
    verification before it can be promoted into the playable resource library.
    """
    source_host = (urlsplit(page_url).hostname or "").lower()
    title = _first(page, "meta[property='og:title']::attr(content)", "title::text")
    poster_raw = _first(
        page,
        "meta[property='og:image']::attr(content)",
        "meta[name='twitter:image']::attr(content)",
        "video::attr(poster)",
    )
    poster = _normalize_candidate(poster_raw, page_url) if poster_raw else None

    navigation: dict[str, dict[str, str]] = {}
    for href in _values(page, "a::attr(href)")[:500]:
        normalized = _normalize_candidate(href, page_url)
        if not normalized:
            continue
        target = urlsplit(normalized)
        if (target.hostname or "").lower() != source_host:
            continue
        if normalized == page_url:
            continue
        label = ""
        role = "detail_page"
        if _PAGE_HINTS.search(f"{target.path} {href}"):
            role = "playback_page" if re.search(r"(?:play|watch|episode|embed)", target.path, re.I) else "detail_page"
        navigation.setdefault(normalized, {"url": normalized, "role": role, "label": label})
        if len(navigation) >= 100:
            break

    candidates: dict[str, dict[str, str]] = {}

    def add_candidate(raw: str, via: str, declared_type: str | None = None) -> None:
        normalized = _normalize_candidate(raw, page_url)
        if not normalized:
            return
        kind = _media_type(normalized, declared_type)
        if not kind:
            return
        candidates.setdefault(
            normalized,
            {
                "url": normalized,
                "media_type": kind,
                "discovered_via": via,
                "validation_status": "pending_fetch_validation",
            },
        )

    for selector, via in (
        ("video::attr(src)", "video_src"),
        ("video source::attr(src)", "video_source"),
        ("source::attr(src)", "source_element"),
        ("iframe::attr(src)", "iframe_player"),
        ("meta[property='og:video']::attr(content)", "og_video"),
        ("meta[property='og:video:url']::attr(content)", "og_video_url"),
        ("meta[name='twitter:player:stream']::attr(content)", "twitter_stream"),
    ):
        for value in _values(page, selector)[:100]:
            add_candidate(value, via)

    for value in _values(page, "source::attr(type)")[:100]:
        if "mpegurl" in value.lower() or "dash+xml" in value.lower():
            # The corresponding source URL is already captured above; this keeps
            # MIME inference local and does not create a URL from an untrusted type.
            continue

    for script in _values(page, "script::text")[:200]:
        for match in _MEDIA_URL_PATTERN.findall(script.replace("\\/", "/"))[:50]:
            add_candidate(match, "inline_script")

    return {
        "title": title,
        "poster_url": poster,
        "discovered_pages": list(navigation.values()),
        "media_candidates": list(candidates.values()),
        "discovery_only": True,
    }
