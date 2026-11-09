from __future__ import annotations

import time
from threading import Lock
from urllib.parse import urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

from scrapling.fetchers import Fetcher

from app.config import settings


class RobotsPolicyError(PermissionError):
    pass


class RobotsUnavailableError(RuntimeError):
    pass


_CACHE_TTL_SECONDS = 3600
_cache: dict[str, tuple[float, RobotFileParser]] = {}
_cache_lock = Lock()


def ensure_robots_allowed(url: str, timeout: float | None = None) -> None:
    """Fetch and enforce the origin's robots.txt for one-off HTTP fetches."""
    parts = urlsplit(url)
    origin = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
    robots_url = urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", ""))
    now = time.monotonic()

    with _cache_lock:
        cached = _cache.get(origin)
        if cached and now - cached[0] < _CACHE_TTL_SECONDS:
            parser = cached[1]
        else:
            parser = None

    if parser is None:
        try:
            response = Fetcher.get(
                robots_url,
                timeout=timeout or settings.request_timeout_seconds,
                follow_redirects="safe",
                headers={"User-Agent": settings.default_user_agent},
            )
        except Exception as exc:
            raise RobotsUnavailableError(
                "robots.txt could not be checked; refusing the fetch."
            ) from exc
        status = getattr(response, "status", 200)
        if isinstance(status, int) and (status in {401, 403, 429} or status >= 500):
            raise RobotsUnavailableError("robots.txt could not be checked; refusing the fetch.")
        parser = RobotFileParser(robots_url)
        if isinstance(status, int) and 400 <= status < 500:
            parser.parse([])
        else:
            body = getattr(response, "body", b"")
            if not isinstance(body, (bytes, bytearray)):
                body = str(body).encode("utf-8")
            parser.parse(bytes(body).decode("utf-8", errors="replace").splitlines())
        with _cache_lock:
            _cache[origin] = (now, parser)

    if not parser.can_fetch(settings.default_user_agent, url):
        raise RobotsPolicyError("The target URL is disallowed by the site's robots.txt policy.")
