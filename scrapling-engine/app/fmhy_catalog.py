from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import re
from dataclasses import asdict, dataclass
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.config import settings
from app.security import validate_public_http_url

FMHY_REPOSITORY = "fmhy/edit"
FMHY_BRANCH = "main"
FMHY_RAW_BASE = "https://raw.githubusercontent.com/fmhy/edit"
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_CONCURRENT_SOURCE_REQUESTS = 3
FMHY_SOURCE_FILES = (
    "privacy.md", "ai.md", "mobile.md", "audio.md", "beginners-guide.md",
    "developer-tools.md", "downloading.md", "educational.md", "file-tools.md",
    "gaming-tools.md", "gaming.md", "image-tools.md", "internet-tools.md",
    "linux-macos.md", "misc.md", "non-english.md", "reading.md",
    "social-media-tools.md", "storage.md", "system-tools.md", "text-tools.md",
    "torrenting.md", "unsafe.md", "video-tools.md", "video.md",
)
_MARKERS = ("🌟", "⭐", "🌐", "↪️")
_REPOSITORY_HOSTS = {"github.com", "gitlab.com", "codeberg.org", "bitbucket.org"}
_COMMUNITY_HOSTS = {
    "reddit.com",
    "www.reddit.com",
    "discord.com",
    "discord.gg",
    "t.me",
    "telegram.me",
}
_AUXILIARY_LABELS = {
    "discord",
    "telegram",
    "github",
    "gitlab",
    "source",
    "status",
    "guide",
    "wiki",
    "api",
    "instances",
}


def parse_official_source_file_list(route_source: str) -> tuple[str, ...]:
    block = re.search(
        r"const\s+files\s*=\s*\(\s*\[(.*?)\]\s*as\s+const",
        route_source,
        re.DOTALL,
    )
    if block is None:
        raise RuntimeError("FMHY single-page route did not expose its source file list.")
    names = re.findall(r"""['"]([^'"]+)['"]""", block.group(1))
    if not names or len(names) > 100:
        raise RuntimeError("FMHY source file list is empty or exceeds the safety limit.")
    if any(not re.fullmatch(r"[a-z0-9-]+\.md", name) for name in names):
        raise RuntimeError("FMHY source list contains an unsupported file path.")
    if len(names) != len(set(names)):
        raise RuntimeError("FMHY source list contains duplicate files.")
    return tuple(names)


@dataclass(frozen=True)
class CatalogLink:
    label: str
    original_url: str
    canonical_url: str
    domain: str
    role: str
    is_primary: bool
    order: int


@dataclass(frozen=True)
class CatalogEntry:
    entry_id: str
    title: str
    category: str
    section_path: tuple[str, ...]
    source_file: str
    source_line: int
    marker: str | None
    safety_status: str
    source_url: str
    links: tuple[CatalogLink, ...]


def _stable_id(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonicalize_url(raw_url: str) -> tuple[str, str] | None:
    try:
        parsed = urlsplit(raw_url.strip())
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        port = parsed.port
    except ValueError:
        return None
    host = parsed.hostname.rstrip(".").lower()
    if not host or host == "localhost" or host.endswith(".localhost"):
        return None
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        return None
    scheme = parsed.scheme.lower()
    default_port = 443 if scheme == "https" else 80
    if port is not None and (port not in {80, 443} or port != default_port):
        return None
    canonical = urlunsplit((scheme, host, parsed.path or "/", parsed.query, ""))
    return canonical, host


def _link_role(label: str, host: str) -> str:
    normalized = label.strip().lower()
    if host in _REPOSITORY_HOSTS or any(host.endswith(f".{item}") for item in _REPOSITORY_HOSTS):
        return "repository"
    if host in _COMMUNITY_HOSTS or any(host.endswith(f".{item}") for item in _COMMUNITY_HOSTS):
        return "community"
    if normalized.isdigit() or normalized in {"mirror", "mirrors"}:
        return "mirror"
    if normalized in _AUXILIARY_LABELS:
        return "reference"
    return "resource"


def _extract_markdown_links(line: str) -> list[tuple[str, str]]:
    links: list[tuple[str, str]] = []
    cursor = 0
    while cursor < len(line):
        start = line.find("[", cursor)
        if start < 0:
            break
        if start > 0 and line[start - 1] == "!":
            cursor = start + 1
            continue
        label_end = line.find("](", start + 1)
        if label_end < 0:
            cursor = start + 1
            continue
        label = line[start + 1:label_end].strip()
        url_start = label_end + 2
        while url_start < len(line) and line[url_start].isspace():
            url_start += 1
        if url_start < len(line) and line[url_start] == "<":
            url_start += 1
            url_end = line.find(">", url_start)
            if url_end < 0:
                cursor = label_end + 2
                continue
            raw_url = line[url_start:url_end]
            cursor = url_end + 1
        else:
            url_end = url_start
            depth = 0
            while url_end < len(line):
                char = line[url_end]
                if char == "(":
                    depth += 1
                elif char == ")":
                    if depth == 0:
                        break
                    depth -= 1
                elif char.isspace() and depth == 0:
                    break
                url_end += 1
            raw_url = line[url_start:url_end]
            cursor = max(url_end, label_end + 2)
        if raw_url.lower().startswith(("http://", "https://")):
            links.append((label, raw_url))
        if cursor <= start:
            cursor = start + 1
    return links


def _clean_description(line: str) -> str:
    text = re.sub(r"^\s*(?:[*+-]|\d+\.)\s*", "", line)
    text = re.sub(r"^[🌟⭐🌐↪️]\s*", "", text)
    text = re.sub(r"\[[^\]]+\]\([^)]*\)", "", text)
    text = text.replace(chr(96), "").replace("**", "").replace("__", "")
    return re.sub(r"\s+", " ", text).strip(" -–—|")


def parse_fmhy_markdown(
    source_file: str,
    markdown: str,
    source_revision: str = FMHY_BRANCH,
) -> list[CatalogEntry]:
    category = source_file.removesuffix(".md")
    safety_status = "flagged_unsafe" if category == "unsafe" else "unverified"
    headings: list[str] = []
    entries: list[CatalogEntry] = []
    in_code_fence = False
    fence = chr(96) * 3
    for line_number, raw_line in enumerate(markdown.splitlines(), start=1):
        stripped = raw_line.strip()
        if stripped.startswith((fence, "~~~")):
            in_code_fence = not in_code_fence
            continue
        if in_code_fence:
            continue
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", stripped)
        if heading:
            level = len(heading.group(1))
            headings = headings[: level - 1]
            headings.append(heading.group(2).strip())
            continue
        if not re.match(r"^\s*(?:[*+-]|\d+\.)\s+", raw_line):
            continue
        marker = next((item for item in _MARKERS if item in raw_line), None)
        links: list[CatalogLink] = []
        for index, (label, original_url) in enumerate(_extract_markdown_links(raw_line)):
            original_url = original_url.rstrip(".,;")
            normalized = _canonicalize_url(original_url)
            if normalized is None:
                continue
            canonical_url, domain = normalized
            role = _link_role(label, domain)
            if marker == "↪️":
                role = "navigation"
            elif marker == "🌐" and role in {"resource", "alternate"}:
                role = "index"
            links.append(
                CatalogLink(
                    label, original_url, canonical_url, domain, role, False, index
                )
            )
        if not links and safety_status != "flagged_unsafe":
            continue
        primary_index = next(
            (i for i, link in enumerate(links) if link.role == "resource"),
            None,
        )
        if primary_index is not None:
            links = [
                CatalogLink(
                    link.label,
                    link.original_url,
                    link.canonical_url,
                    link.domain,
                    (
                        "primary"
                        if i == primary_index
                        else "alternate" if link.role == "resource" else link.role
                    ),
                    i == primary_index,
                    link.order,
                )
                for i, link in enumerate(links)
            ]
        title = next(
            (link.label for link in links if link.is_primary),
            links[0].label if links else "",
        )
        cleaned_text = _clean_description(raw_line)
        plain_title = re.split(r"\s[-–—]\s", cleaned_text, maxsplit=1)[0]
        title = title or plain_title[:160] or f"{category} entry {line_number}"
        source_url = (
            f"https://github.com/{FMHY_REPOSITORY}/blob/"
            f"{source_revision}/docs/{source_file}#L{line_number}"
        )
        entries.append(
            CatalogEntry(
                _stable_id(f"{source_file}:{line_number}:{title}"),
                title[:300],
                category,
                tuple(headings),
                source_file,
                line_number,
                marker,
                safety_status,
                source_url,
                tuple(links),
            )
        )
    return entries


async def _fetch_source(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    source_file: str,
    source_revision: str,
) -> str:
    url = f"{FMHY_RAW_BASE}/{source_revision}/docs/{source_file}"
    async with semaphore:
        async with client.stream("GET", url) as response:
            if response.status_code != 200:
                raise RuntimeError(
                    f"FMHY source {source_file} returned HTTP {response.status_code}."
                )
            if response.url.host != "raw.githubusercontent.com":
                raise RuntimeError("FMHY source redirected away from the official raw host.")
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > MAX_SOURCE_BYTES:
                raise RuntimeError(f"FMHY source {source_file} exceeds the size limit.")
            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > MAX_SOURCE_BYTES:
                    raise RuntimeError(f"FMHY source {source_file} exceeds the size limit.")
                chunks.append(chunk)
            return b"".join(chunks).decode("utf-8-sig")


async def fetch_official_fmhy_sources() -> tuple[dict[str, str], str]:
    timeout = httpx.Timeout(settings.request_timeout_seconds)
    limits = httpx.Limits(
        max_connections=MAX_CONCURRENT_SOURCE_REQUESTS,
        max_keepalive_connections=MAX_CONCURRENT_SOURCE_REQUESTS,
    )
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_SOURCE_REQUESTS)
    async with httpx.AsyncClient(
        timeout=timeout,
        limits=limits,
        headers={"User-Agent": settings.default_user_agent},
        follow_redirects=False,
    ) as client:
        commit_url = "https://api.github.com/repos/fmhy/edit/commits/main"
        validate_public_http_url(commit_url)
        commit_response = await client.get(commit_url)
        commit_response.raise_for_status()
        if len(commit_response.content) > 1_000_000:
            raise RuntimeError("FMHY commit metadata exceeded the size limit.")
        source_revision = commit_response.json().get("sha", "")
        if not re.fullmatch(r"[0-9a-f]{40}", source_revision):
            raise RuntimeError("FMHY API did not return a valid immutable source commit.")
        route_url = (
            f"{FMHY_RAW_BASE}/{source_revision}/api/routes/single-page.ts"
        )
        validate_public_http_url(route_url)
        route_response = await client.get(route_url)
        route_response.raise_for_status()
        if route_response.url.host != "raw.githubusercontent.com":
            raise RuntimeError("FMHY source manifest did not come from the official raw host.")
        if len(route_response.content) > 1_000_000:
            raise RuntimeError("FMHY source manifest exceeded the size limit.")
        source_files = parse_official_source_file_list(route_response.text)
        results = await asyncio.gather(*(
            _fetch_source(client, semaphore, source_file, source_revision)
            for source_file in source_files
        ))
    return dict(zip(source_files, results, strict=True)), source_revision


async def sync_fmhy_catalog(store) -> dict:
    sources, source_revision = await fetch_official_fmhy_sources()
    entries = [
        entry
        for source_file, markdown in sources.items()
        for entry in parse_fmhy_markdown(source_file, markdown, source_revision)
    ]
    result = store.import_snapshot(
        entries,
        source_repository=FMHY_REPOSITORY,
        source_branch=FMHY_BRANCH,
        source_revision=source_revision,
        source_count=len(sources),
    )
    result["source_files"] = len(sources)
    return result


def entry_to_dict(entry: CatalogEntry) -> dict:
    payload = asdict(entry)
    payload["section_path"] = list(entry.section_path)
    payload["links"] = [asdict(link) for link in entry.links]
    return payload
