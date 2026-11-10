from __future__ import annotations

import csv
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import hmac
import ipaddress
import json
import math
import os
import re
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
from scrapling.fetchers import Fetcher, FetcherSession, StealthySession
from scrapling.spiders import Response, Spider

FMHY_VIDEO_URL = "https://fmhy.net/video"
TOKEN = os.environ.get("SCRAPLING_API_TOKEN", "").strip()
DB_PATH = Path(os.environ.get("SCRAPLING_DB_PATH", "/data/collector.sqlite3"))
MAX_RESULTS = 100
MAX_CANDIDATES = 100
MAX_CRAWL_DEPTH = 2
MAX_CRAWL_PAGES = 12
MAX_CRAWL_LINKS_PER_PAGE = 8
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
        # Forward-only, additive migrations keep existing collector volumes compatible.
        candidate_columns = {row["name"] for row in connection.execute("PRAGMA table_info(candidates)").fetchall()}
        candidate_migrations = {
            "collected_by": "TEXT NOT NULL DEFAULT '[]'",
            "access_state": "TEXT NOT NULL DEFAULT 'ACCESS_UNKNOWN'",
            "access_reason": "TEXT",
            "probe_evidence": "TEXT NOT NULL DEFAULT '{}'",
            "media_identity": "TEXT NOT NULL DEFAULT '{}'",
            "quality_evidence": "TEXT NOT NULL DEFAULT '{}'",
        }
        for column, declaration in candidate_migrations.items():
            if column not in candidate_columns:
                connection.execute(f"ALTER TABLE candidates ADD COLUMN {column} {declaration}")
        connection.execute(
            "UPDATE candidates SET access_state='ACCESS_UNKNOWN' WHERE access_state IS NULL OR access_state=''"
        )
        connection.execute("UPDATE tasks SET status='interrupted',updated_at=? WHERE status='running'", (int(time.time()),))


init_db()


def require_token(authorization: str | None) -> None:
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not supplied or not hmac.compare_digest(supplied, TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


def require_egress_firewall() -> None:
    """Fail closed unless the operator confirms an enforced host-level egress boundary.

    DNS checks in application code cannot prevent rebinding between resolution
    and connection. This opt-in flag is an operator assertion, not an automatic
    firewall installer or a substitute for verifying the actual host rules.
    """
    if os.environ.get("SCRAPLING_EGRESS_FIREWALL_CONFIRMED", "").strip() != "1":
        raise HTTPException(
            status_code=503,
            detail="Crawling is disabled until host-level egress filtering is installed and verified",
        )


def resolve_public_addresses(host: str) -> list[str]:
    """Resolve once, reject mixed/private answers, and return validated IP literals."""
    try:
        literal_address = ipaddress.ip_address(host)
    except ValueError:
        literal_address = None
    if literal_address is not None:
        addresses = {str(literal_address)}
    else:
        try:
            addresses = {
                str(ipaddress.ip_address(entry[4][0]))
                for entry in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            }
        except (OSError, ValueError):
            raise HTTPException(status_code=400, detail="Unable to resolve target host")
    if not addresses:
        raise HTTPException(status_code=400, detail="Target host has no address")
    if any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise HTTPException(status_code=400, detail="Private or reserved network targets are blocked")
    return sorted(addresses, key=lambda value: (ipaddress.ip_address(value).version, value))


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
    resolve_public_addresses(host)
    return raw_url, host


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS connection pinned to a previously validated public IP address.

    The URL hostname remains the TLS SNI and certificate-verification name,
    while TCP connects directly to the validated IP literal (no second DNS lookup).
    """

    def __init__(self, host: str, pinned_ip: str, *args, **kwargs):
        self.pinned_ip = str(ipaddress.ip_address(pinned_ip))
        super().__init__(host, *args, **kwargs)

    def connect(self) -> None:
        address = ipaddress.ip_address(self.pinned_ip)
        family = socket.AF_INET6 if address.version == 6 else socket.AF_INET
        sock = socket.socket(family, socket.SOCK_STREAM)
        try:
            if self.timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                sock.settimeout(self.timeout)
            sock.connect((self.pinned_ip, self.port))
            if self._tunnel_host is not None:
                raise OSError("HTTPS proxy tunneling is not supported for pinned connections")
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


MAX_MANIFEST_BYTES = 1024 * 1024


def parse_hls_attribute_list(raw: str) -> dict[str, str]:
    """Parse HLS key=value attributes, preserving commas inside quoted values."""
    attrs: dict[str, str] = {}
    index = 0
    length = len(raw)
    while index < length:
        while index < length and (raw[index].isspace() or raw[index] == ","):
            index += 1
        key_start = index
        while index < length and raw[index] not in "=,":
            index += 1
        if index >= length or raw[index] != "=":
            while index < length and raw[index] != ",":
                index += 1
            continue
        key = raw[key_start:index].strip().upper()
        index += 1
        if index < length and raw[index] == '"':
            index += 1
            value_start = index
            while index < length and raw[index] != '"':
                index += 1
            value = raw[value_start:index]
            if index < length:
                index += 1
            while index < length and raw[index] != ",":
                index += 1
        else:
            value_start = index
            while index < length and raw[index] != ",":
                index += 1
            value = raw[value_start:index].strip()
        if key:
            attrs[key] = value
        if index < length and raw[index] == ",":
            index += 1
    return attrs


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
    key_formats: set[str] = set()
    key_uri_present = False
    for line in lines[1:]:
        if line.startswith("#EXT-X-STREAM-INF:"):
            attrs = parse_hls_attribute_list(line.split(":", 1)[1])
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
            attrs = parse_hls_attribute_list(line.split(":", 1)[1])
            method = attrs.get("METHOD", "UNKNOWN")
            encryption_methods.add(method)
            if attrs.get("KEYFORMAT"):
                key_formats.add(attrs["KEYFORMAT"])
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
        "key_formats": sorted(key_formats),
        "key_uri_present": key_uri_present,
    }


def _xml_children(node, name: str):
    return [child for child in list(node) if child.tag.split("}")[-1] == name]


def _first_base_url(node) -> str | None:
    values = _xml_children(node, "BaseURL")
    if not values:
        return None
    return (values[0].text or "").strip() or None


def parse_iso8601_duration_seconds(value: str | None) -> float | None:
    """Parse the day/time subset of ISO-8601 durations used by DASH."""
    if not value:
        return None
    match = re.fullmatch(
        r"P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?",
        value,
    )
    if not match or not any(part is not None for part in match.groups()):
        return None
    try:
        days, hours, minutes, seconds = (float(part or 0) for part in match.groups())
        total = days * 86400 + hours * 3600 + minutes * 60 + seconds
    except (OverflowError, ValueError):
        return None
    return total if math.isfinite(total) else None


def expand_dash_template(template: str, representation: dict, number: int, media_time: int) -> str:
    """Expand the finite DASH template tokens needed for bounded timeline inspection."""
    sentinel = "\x00DASH_DOLLAR\x00"
    value = template.replace("$$", sentinel)
    replacements = {
        "RepresentationID": str(representation.get("id") or ""),
        "Bandwidth": str(representation.get("bandwidth") or ""),
        "Number": str(number),
        "Time": str(media_time),
    }
    pattern = re.compile(r"\$(RepresentationID|Bandwidth|Number|Time)(%0(\d+)d)?\$")
    def substitute(match):
        token = match.group(1)
        replacement = replacements[token]
        width = match.group(3)
        if width and token in ("Number", "Time") and replacement:
            # The width comes from an untrusted MPD template; bound padding work.
            replacement = replacement.zfill(min(int(width), 20))
        return replacement
    return pattern.sub(substitute, value).replace(sentinel, "$")


def parse_mpd_manifest(body: bytes, base_url: str = "") -> dict:
    # MPDs are untrusted input; reject DTD/entity declarations before XML parsing.
    upper_body = body.upper()
    if b"<!DOCTYPE" in upper_body or b"<!ENTITY" in upper_body:
        return {"manifest_valid": False, "manifest_error": "doctype_or_entity_blocked"}
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return {"manifest_valid": False, "manifest_error": "invalid_xml"}
    if root.tag.split("}")[-1] != "MPD":
        return {"manifest_valid": False, "manifest_error": "missing_mpd_root"}

    representations = []
    base_references: list[str] = []
    template_references: list[str] = []
    segment_references: list[str] = []
    dynamic = root.attrib.get("type", "static").lower() == "dynamic"
    mpd_duration = parse_iso8601_duration_seconds(root.attrib.get("mediaPresentationDuration"))
    time_shift_depth = parse_iso8601_duration_seconds(root.attrib.get("timeShiftBufferDepth"))
    dynamic_metadata = {
        key: root.attrib.get(key)
        for key in (
            "availabilityStartTime", "publishTime", "minimumUpdatePeriod",
            "timeShiftBufferDepth", "suggestedPresentationDelay",
        )
        if root.attrib.get(key) is not None
    }
    dynamic_metadata["minimum_update_period_seconds"] = parse_iso8601_duration_seconds(root.attrib.get("minimumUpdatePeriod"))
    dynamic_metadata["time_shift_buffer_depth_seconds"] = time_shift_depth
    dynamic_metadata["suggested_presentation_delay_seconds"] = parse_iso8601_duration_seconds(root.attrib.get("suggestedPresentationDelay"))

    def walk_period(period, mpd_base: str, inherited_template: dict, inherited_timeline=None, duration_override=None):
        period_base = _first_base_url(period)
        current_base = urljoin(mpd_base, period_base) if period_base else mpd_base
        period_templates = dict(inherited_template)
        period_timeline = inherited_timeline
        for node in _xml_children(period, "SegmentTemplate"):
            period_templates.update(node.attrib)
            timelines = _xml_children(node, "SegmentTimeline")
            if timelines:
                period_timeline = timelines[0]
        period_duration = parse_iso8601_duration_seconds(period.attrib.get("duration"))
        if period_duration is None:
            period_duration = duration_override
        for adaptation in _xml_children(period, "AdaptationSet"):
            adaptation_base = _first_base_url(adaptation)
            adaptation_url = urljoin(current_base, adaptation_base) if adaptation_base else current_base
            adaptation_templates = dict(period_templates)
            adaptation_timeline = period_timeline
            for node in _xml_children(adaptation, "SegmentTemplate"):
                adaptation_templates.update(node.attrib)
                timelines = _xml_children(node, "SegmentTimeline")
                if timelines:
                    adaptation_timeline = timelines[0]
            for representation in _xml_children(adaptation, "Representation"):
                representation_base = _first_base_url(representation)
                resolved_base = urljoin(adaptation_url, representation_base) if representation_base else adaptation_url
                if resolved_base != mpd_base and len(base_references) < 50:
                    base_references.append(resolved_base)

                template = dict(adaptation_templates)
                timeline_node = adaptation_timeline
                for node in _xml_children(representation, "SegmentTemplate"):
                    template.update(node.attrib)
                    timelines = _xml_children(node, "SegmentTimeline")
                    if timelines:
                        timeline_node = timelines[0]
                template_refs = {}
                for key in ("media", "initialization"):
                    value = template.get(key)
                    if value:
                        resolved = urljoin(resolved_base, value)
                        template_refs[key] = resolved
                        if len(template_references) < 50:
                            template_references.append(resolved)

                try:
                    width = int(representation.attrib["width"]) if representation.attrib.get("width") else None
                    height = int(representation.attrib["height"]) if representation.attrib.get("height") else None
                    bandwidth = int(representation.attrib["bandwidth"]) if representation.attrib.get("bandwidth") else None
                except ValueError:
                    width = height = bandwidth = None
                representation_info = {
                    "id": representation.attrib.get("id"),
                    "width": width,
                    "height": height,
                    "bandwidth": bandwidth,
                    "codecs": representation.attrib.get("codecs") or adaptation.attrib.get("codecs"),
                    "base_url": resolved_base,
                    "segment_template": template_refs,
                    "segment_list": [],
                    "segment_timeline": [],
                }

                timeline_truncated = False
                if timeline_node is not None and template.get("media"):
                    try:
                        timescale = max(1, int(template.get("timescale", "1")))
                        start_number = max(0, int(template.get("startNumber", "1")))
                    except ValueError:
                        timescale, start_number = 1, 1
                    cursor = 0
                    segment_number = start_number
                    entries = _xml_children(timeline_node, "S")
                    for index, entry in enumerate(entries):
                        try:
                            duration = int(entry.attrib.get("d", "0"))
                            if duration <= 0:
                                continue
                            start = int(entry.attrib["t"]) if entry.attrib.get("t") is not None else cursor
                            repeat = int(entry.attrib.get("r", "0"))
                        except ValueError:
                            continue
                        if repeat >= 0:
                            count = repeat + 1
                        else:
                            next_start = None
                            for following in entries[index + 1:]:
                                if following.attrib.get("t") is not None:
                                    try:
                                        next_start = int(following.attrib["t"])
                                    except ValueError:
                                        pass
                                    break
                            if next_start is not None:
                                count = max(0, (next_start - start + duration - 1) // duration)
                            elif period_duration is not None:
                                end_tick = int(period_duration * timescale)
                                count = max(0, (end_tick - start + duration - 1) // duration)
                            else:
                                # timeShiftBufferDepth is a window length, not an absolute
                                # timeline end. Without a trustworthy live edge, do not emit
                                # speculative segment URLs for an open-ended dynamic repeat.
                                count = 0
                                timeline_truncated = True
                                if dynamic:
                                    representation_info["timeline_requires_live_edge"] = True
                                else:
                                    representation_info["timeline_requires_duration_boundary"] = True
                        for offset in range(count):
                            if len(representation_info["segment_timeline"]) >= 50:
                                timeline_truncated = True
                                break
                            media_time = start + offset * duration
                            media_path = expand_dash_template(
                                template["media"], representation_info,
                                segment_number, media_time,
                            )
                            media_url = urljoin(resolved_base, media_path)
                            representation_info["segment_timeline"].append({
                                "number": segment_number, "time": media_time,
                                "duration": duration, "url": media_url,
                            })
                            if len(segment_references) < 50:
                                segment_references.append(media_url)
                            segment_number += 1
                        cursor = start + count * duration
                        if len(representation_info["segment_timeline"]) >= 50:
                            break
                representation_info["segment_timeline_truncated"] = timeline_truncated

                segment_list_refs = []
                segment_lists = _xml_children(representation, "SegmentList")
                if not segment_lists:
                    segment_lists = _xml_children(adaptation, "SegmentList")
                if not segment_lists:
                    segment_lists = _xml_children(period, "SegmentList")
                for segment_list in segment_lists[:1]:
                    for initialization in _xml_children(segment_list, "Initialization"):
                        source = initialization.attrib.get("sourceURL")
                        if source:
                            segment_list_refs.append(urljoin(resolved_base, source))
                    for segment in _xml_children(segment_list, "SegmentURL"):
                        media = segment.attrib.get("media")
                        if media and len(segment_list_refs) < 50:
                            segment_list_refs.append(urljoin(resolved_base, media))
                representation_info["segment_list"] = segment_list_refs[:50]
                segment_references.extend(segment_list_refs[: max(0, 50 - len(segment_references))])
                representations.append(representation_info)

    mpd_base = base_url
    root_base = _first_base_url(root)
    if root_base:
        mpd_base = urljoin(base_url, root_base)
    root_templates = {}
    root_timeline = None
    for node in _xml_children(root, "SegmentTemplate"):
        root_templates.update(node.attrib)
        timelines = _xml_children(node, "SegmentTimeline")
        if timelines:
            root_timeline = timelines[0]
    periods = _xml_children(root, "Period")
    inferred_period_end = 0.0
    for index, period in enumerate(periods):
        period_start = parse_iso8601_duration_seconds(period.attrib.get("start"))
        if period_start is None:
            period_start = inferred_period_end if index == 0 or inferred_period_end > 0 else None
        explicit_duration = parse_iso8601_duration_seconds(period.attrib.get("duration"))
        duration_override = None
        if explicit_duration is None and period_start is not None:
            next_start = None
            for following in periods[index + 1:]:
                next_start = parse_iso8601_duration_seconds(following.attrib.get("start"))
                if next_start is not None:
                    break
            boundary = next_start if next_start is not None else mpd_duration
            if boundary is not None and boundary >= period_start:
                duration_override = boundary - period_start
        effective_duration = explicit_duration if explicit_duration is not None else duration_override
        if period_start is not None and effective_duration is not None:
            inferred_period_end = period_start + effective_duration
        else:
            inferred_period_end = 0.0
        walk_period(period, mpd_base, root_templates, root_timeline, duration_override)

    if not representations:
        return {"manifest_valid": False, "manifest_error": "missing_representations"}

    return {
        "manifest_valid": True,
        "manifest_type": "dash",
        "dynamic": dynamic,
        "dynamic_metadata": dynamic_metadata,
        "representation_count": len(representations),
        "representations": representations[:20],
        "base_urls": base_references,
        "segment_template_urls": template_references,
        "segment_urls": segment_references,
    }


def validate_manifest_references(manifest: dict, base_url: str) -> dict:
    """Resolve and DNS-check manifest references without fetching media or key URLs."""
    rejected = 0

    def safe_reference(reference: str) -> str | None:
        nonlocal rejected
        absolute = urljoin(base_url, reference)
        try:
            public_https_url(absolute)
        except HTTPException:
            rejected += 1
            return None
        return absolute

    result = dict(manifest)
    safe_variants = []
    for variant in manifest.get("variants", []):
        item = dict(variant)
        uri = item.get("uri")
        resolved = safe_reference(uri) if isinstance(uri, str) else None
        if resolved:
            item["uri"] = resolved
            safe_variants.append(item)
    if "variants" in result:
        result["variants"] = safe_variants
        result["variant_count"] = len(safe_variants)

    for source_key in ("segment_uris", "base_urls", "segment_template_urls", "segment_urls"):
        safe_values = []
        for reference in manifest.get(source_key, [])[:50]:
            resolved = safe_reference(reference) if isinstance(reference, str) else None
            if resolved:
                safe_values.append(resolved)
        if source_key in result:
            result[source_key] = safe_values
            if source_key == "segment_uris":
                result["segment_count"] = len(safe_values)

    safe_representations = []
    for representation in manifest.get("representations", []):
        item = dict(representation)
        resolved_base = safe_reference(item.get("base_url", "")) if item.get("base_url") else None
        if item.get("base_url") and not resolved_base:
            continue
        if resolved_base:
            item["base_url"] = resolved_base
        templates = {}
        for key, reference in item.get("segment_template", {}).items():
            resolved = safe_reference(reference)
            if resolved:
                templates[key] = resolved
        if "segment_template" in item:
            item["segment_template"] = templates
        safe_list = []
        for reference in item.get("segment_list", []):
            resolved = safe_reference(reference)
            if resolved:
                safe_list.append(resolved)
        if "segment_list" in item:
            item["segment_list"] = safe_list
        safe_timeline = []
        for entry in item.get("segment_timeline", []):
            timeline_item = dict(entry)
            resolved = safe_reference(timeline_item.get("url", ""))
            if resolved:
                timeline_item["url"] = resolved
                safe_timeline.append(timeline_item)
        if "segment_timeline" in item:
            item["segment_timeline"] = safe_timeline
        safe_representations.append(item)
    if "representations" in result:
        result["representations"] = safe_representations
        result["representation_count"] = len(safe_representations)

    result["rejected_reference_count"] = rejected
    result["safe_reference_count"] = (
        len(safe_variants)
        + sum(len(result.get(key, [])) for key in ("segment_uris", "base_urls", "segment_template_urls", "segment_urls"))
    )
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
        # Pin the TCP destination to the exact address validated immediately
        # before connect(). TLS still verifies/SNIs the original hostname.
        try:
            pinned_ip = resolve_public_addresses(host)[0]
        except HTTPException:
            return {"reachable": False, "error": "unsafe_or_invalid_redirect_target"}
        connection = PinnedHTTPSConnection(
            host, pinned_ip, 443, timeout=10, context=ssl.create_default_context()
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
                    manifest = parse_mpd_manifest(body, normalized)
                    if manifest.get("manifest_valid"):
                        manifest = validate_manifest_references(manifest, normalized)
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


def probe_hls_variant_tree(
    manifest: dict,
    max_depth: int = 2,
    max_variants_per_level: int = 3,
    max_segments_per_playlist: int = 3,
    max_requests: int = 12,
) -> dict:
    """Follow a bounded HLS master -> variant -> media-playlist tree."""
    state = {"requests": 0, "visited": set(), "leaf_successes": 0}
    results = []

    def walk(current_manifest: dict, depth: int) -> list[dict]:
        level_results = []
        variants = current_manifest.get("variants", [])[:max_variants_per_level]
        for variant in variants:
            if state["requests"] >= max_requests:
                break
            url = variant.get("uri")
            if not isinstance(url, str) or url in state["visited"]:
                continue
            try:
                _, host = public_https_url(url)
            except HTTPException:
                level_results.append({"reachable": False, "error": "unsafe_variant_url"})
                continue
            state["visited"].add(url)
            throttle(host)
            state["requests"] += 1
            probe = probe_direct_media(url)
            item = {
                "url": url,
                "height": variant.get("height"),
                "bandwidth": variant.get("bandwidth"),
                "reachable": bool(probe.get("reachable")),
                "http_status": probe.get("http_status"),
                "media_format": probe.get("media_format"),
            }
            child_manifest = probe if probe.get("manifest_valid") else {}
            if (
                not item["reachable"]
                or probe.get("media_format") != "hls"
                or probe.get("rejected_reference_count", 0) > 0
            ):
                item["reachable"] = False
            elif child_manifest.get("is_master_playlist"):
                if depth < max_depth:
                    nested = walk(child_manifest, depth + 1)
                    item["children"] = nested
                    item["reachable"] = any(child.get("leaf_reachable") for child in nested)
                    item["leaf_reachable"] = item["reachable"]
                else:
                    item["reachable"] = False
                    item["depth_limit_reached"] = True
            else:
                segment_urls = child_manifest.get("segment_uris", [])
                declared_segments = child_manifest.get("segment_count", 0)
                if declared_segments:
                    remaining = max_requests - state["requests"]
                    sample_limit = min(max_segments_per_playlist, remaining)
                    if sample_limit > 0:
                        segment_probe = probe_hls_segments(segment_urls, max_segments=sample_limit)
                        state["requests"] += segment_probe["sampled"]
                        item["segment_probe"] = segment_probe
                        item["reachable"] = (
                            segment_probe["sampled"] > 0
                            and segment_probe["failed"] == 0
                        )
                    else:
                        item["reachable"] = False
                        item["request_budget_exhausted"] = True
                # A media playlist without any segment references is not a playable leaf.
                if not declared_segments or not segment_urls:
                    item["reachable"] = False
                    item["empty_media_playlist"] = True
                item["leaf_reachable"] = bool(item["reachable"])
                if item["leaf_reachable"]:
                    state["leaf_successes"] += 1
            level_results.append(item)
        return level_results

    results = walk(manifest, 0)
    return {
        "sampled_variant_count": len(state["visited"]),
        "reachable_leaf_count": state["leaf_successes"],
        "request_count": state["requests"],
        "request_limit": max_requests,
        "max_depth": max_depth,
        "results": results,
        "note": "Variant playlists and a bounded segment sample were checked; this is not a complete playback test.",
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


def fmhy_category_pages_from_page(page) -> list[str]:
    """Find a small set of FMHY-owned video category pages; never follow external links here."""
    pages: list[str] = []
    seen: set[str] = set()
    for anchor in adaptive_css(page, "a"):
        href = (anchor.attrib.get("href") or "").strip()
        if not href:
            continue
        target = urljoin(FMHY_VIDEO_URL, href)
        parsed = urlparse(target)
        if parsed.scheme != "https" or parsed.hostname != "fmhy.net":
            continue
        path = parsed.path.rstrip("/") or "/"
        signal = f"{path} {text_of(anchor).lower()}"
        if path == "/video" or not any(
            marker in signal for marker in ("video", "movie", "film", "tv", "anime", "cartoon", "影视", "电影", "动漫")
        ):
            continue
        canonical = parsed._replace(fragment="").geturl()
        if canonical not in seen:
            seen.add(canonical)
            pages.append(canonical)
        if len(pages) >= 8:
            break
    return pages


def fmhy_sites_from_page(page, directory_url: str = FMHY_VIDEO_URL) -> list[dict]:
    sites: list[dict] = []
    seen: set[str] = set()
    for anchor in adaptive_css(page, "a"):
        href = (anchor.attrib.get("href") or "").strip()
        if not href:
            continue
        absolute = urljoin(directory_url, href)
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
        sites.append({"title": title, "url": absolute, "host": host, "directory": f"FMHY / {urlparse(directory_url).path.strip('/') or 'Movies-TV-Anime'}"})
        if len(sites) >= MAX_RESULTS:
            break
    return sites


def discover_sites() -> list[dict]:
    throttle("fmhy.net")
    root_page = Fetcher.get(FMHY_VIDEO_URL, timeout=25, follow_redirects="safe")
    directory_pages = [FMHY_VIDEO_URL, *fmhy_category_pages_from_page(root_page)]
    sites_by_host: dict[str, dict] = {}
    for directory_url in directory_pages:
        try:
            if directory_url == FMHY_VIDEO_URL:
                page = root_page
            else:
                throttle("fmhy.net")
                page = Fetcher.get(directory_url, timeout=25, follow_redirects="safe")
            for site in fmhy_sites_from_page(page, directory_url):
                existing = sites_by_host.get(site["host"])
                if existing:
                    labels = set(existing["directory"].split(" | "))
                    labels.add(site["directory"])
                    existing["directory"] = " | ".join(sorted(labels))
                else:
                    sites_by_host[site["host"]] = site
        except Exception:
            # One unavailable FMHY category must not discard other successful pages.
            continue
        if len(sites_by_host) >= MAX_RESULTS:
            break
    sites = list(sites_by_host.values())[:MAX_RESULTS]
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
    if path.endswith((".json", ".json5")) or any(marker in path for marker in ("/api/", "/ajax/", "/graphql")):
        return "public-api-response", parsed.hostname.lower()
    if any(marker in path for marker in ("/embed/", "/player/", "/watch/")):
        return "embedded-player", parsed.hostname.lower()
    return None


def classify_access_state(status_code: int | None = None, headers=None, body: str = "", url: str = "") -> dict:
    """Classify access requirements from observable public response signals only.

    This never attempts authentication, paywall circumvention, DRM key discovery,
    decryption, or access-control bypass.
    """
    header_map = {str(k).lower(): str(v).lower() for k, v in (headers or {}).items()}
    sample = (body or "")[:256_000].lower()
    url_lower = (url or "").lower()
    protection = " ".join((sample, url_lower, header_map.get("content-type", "")))

    drm_systems = []
    for marker, name in (
        ("com.widevine.alpha", "Widevine"),
        ("com.microsoft.playready", "PlayReady"),
        ("com.apple.fps", "FairPlay"),
        ("com.apple.streamingkeydelivery", "FairPlay"),
        ("urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed", "Widevine"),
        ("urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95", "PlayReady"),
        ("skd://", "FairPlay"),
        ("contentprotection", "MPEG-DASH ContentProtection"),
    ):
        if marker in protection and name not in drm_systems:
            drm_systems.append(name)
    if drm_systems:
        return {
            "access_state": "DRM_PROTECTED",
            "reason": "Detected an explicit DRM system or MPEG-DASH ContentProtection signal",
            "drm_systems": drm_systems,
            "next_action": "Use the provider's official player or authorized playback integration",
        }

    # HLS AES-128 / SAMPLE-AES encryption is not, by itself, proof of a DRM system.
    # Preserve that distinction and never fetch or retain key URIs.
    hls_key_lines = re.findall(r"(?im)^#EXT-X-KEY\s*:\s*([^\r\n]+)", sample)
    if hls_key_lines:
        methods = sorted({
            (parse_hls_attribute_list(line).get("METHOD") or "UNKNOWN")
            for line in hls_key_lines
        })
        return {
            "access_state": "ENCRYPTED_STREAM",
            "reason": "HLS encryption signaling detected; DRM system is not established",
            "drm_systems": [],
            "encryption_methods": methods,
            "next_action": "Use an authorized provider playback path; do not retrieve keys or attempt decryption",
        }

    auth_markers = (
        "login required", "sign in to continue", "please log in",
        "authentication required", "unauthorized", "session expired",
        "请先登录", "登录后观看", "登录后继续",
    )
    subscription_markers = (
        "subscription required", "subscribe to watch", "premium members only",
        "upgrade your plan", "payment required", "订阅后观看", "会员专享",
        "开通会员", "付费观看",
    )
    if status_code in (401, 407) or any(marker in sample for marker in auth_markers):
        return {
            "access_state": "AUTH_REQUIRED",
            "reason": "Provider indicates authentication is required",
            "drm_systems": [],
            "next_action": "Ask the user to authenticate through the provider's official flow",
        }
    if status_code == 402 or any(marker in sample for marker in subscription_markers):
        return {
            "access_state": "SUBSCRIPTION_REQUIRED",
            "reason": "Provider indicates a paid subscription or entitlement is required",
            "drm_systems": [],
            "next_action": "Check subscription entitlement through the provider's authorized API",
        }
    if status_code is not None and status_code >= 400:
        return {
            "access_state": "ACCESS_UNKNOWN",
            "reason": f"Provider returned HTTP {status_code}; access requirement is not established",
            "drm_systems": [],
            "next_action": "Do not retry with bypass techniques; inspect provider documentation",
        }
    if status_code is not None and 200 <= status_code < 300:
        return {
            "access_state": "PUBLIC",
            "reason": "No authentication, subscription, or DRM signal detected in the observed response",
            "drm_systems": [],
            "next_action": "Validate the public HTTPS candidate before playback",
        }
    return {
        "access_state": "ACCESS_UNKNOWN",
        "reason": "No target response status or explicit public-access evidence was observed",
        "drm_systems": [],
        "next_action": "Keep candidate out of playback until its own response is verified",
    }


def infer_media_identity(title: str = "", url: str = "") -> dict:
    """Conservative title/URL identity hints; never claim a match without evidence."""
    fallback_name = urlparse(url).path.rsplit("/", 1)[-1] if url else ""
    source = title.strip() if isinstance(title, str) and title.strip() else fallback_name
    release_source = f"{source} {fallback_name}"
    year_match = re.search(r"(?<!\d)((?:19|20)\d{2})(?!\d)", source)
    season_match = re.search(r"(?i)(?:season\s*|s)(\d{1,2})", source)
    episode_match = re.search(r"(?i)(?:episode\s*|ep?)(\d{1,3})", source)
    quality_match = re.search(r"(?i)(2160p|4k|1080p|720p|480p)", release_source)
    codec_match = re.search(r"(?i)(hevc|h\.265|h265|x265|av1|h\.264|h264|x264)", release_source)
    cleaned = re.sub(r"(?i)\.(m3u8|mp4|m4v|webm|mpd|mov|ts|m4s|aac)(?:$|\?).*", "", source)
    cleaned = re.sub(r"(?i)(?:season\s*|s)\d{1,2}|(?:episode\s*|ep?)\d{1,3}|(?<!\d)(?:19|20)\d{2}(?!\d)|2160p|4k|1080p|720p|480p|hevc|h\.?265|x265|av1|h\.?264|x264", " ", cleaned)
    cleaned = re.sub(r"[^\w\u4e00-\u9fff]+", " ", cleaned, flags=re.UNICODE)
    title_hint = " ".join(cleaned.split())[:160]
    year = int(year_match.group(1)) if year_match else None
    season = int(season_match.group(1)) if season_match else None
    episode = int(episode_match.group(1)) if episode_match else None
    quality_hint = quality_match.group(1).lower() if quality_match else None
    codec_hint = codec_match.group(1).lower().replace(".", "") if codec_match else None
    identity_material = "|".join((title_hint.lower(), str(year or ""), str(season or ""), str(episode or "")))
    entity_key = hashlib.sha256(identity_material.encode()).hexdigest()[:24] if title_hint else None
    version_material = "|".join((identity_material, quality_hint or "", codec_hint or ""))
    version_key = hashlib.sha256(version_material.encode()).hexdigest()[:24] if title_hint else None
    return {
        "title_hint": title_hint or None,
        "year_hint": year,
        "season_hint": season,
        "episode_hint": episode,
        "quality_hint": quality_hint,
        "codec_hint": codec_hint,
        "entity_key": entity_key,
        "version_key": version_key,
        "match_confidence": "hint_only",
    }


def build_quality_evidence(validation: dict | None = None) -> dict:
    """Collect declared manifest dimensions separately from observed probe facts."""
    validation = validation or {}
    declared = []
    manifest = validation.get("manifest") or validation.get("probe") or validation
    for variant in manifest.get("variants", []) if isinstance(manifest, dict) else []:
        if isinstance(variant, dict) and isinstance(variant.get("height"), int):
            declared.append({"width": variant.get("width"), "height": variant["height"], "source": "hls_manifest"})
    for representation in manifest.get("representations", []) if isinstance(manifest, dict) else []:
        if isinstance(representation, dict) and isinstance(representation.get("height"), int):
            declared.append({"width": representation.get("width"), "height": representation["height"], "source": "dash_manifest"})
    declared.sort(key=lambda item: (item.get("height") or 0, item.get("width") or 0), reverse=True)
    best = declared[0] if declared else None
    height = best.get("height") if best else None
    return {
        "declared_resolutions": declared[:50],
        "best_declared_resolution": best,
        "declared_quality_label": f"{height}p" if height else None,
        "observed_container_resolution": None,
        "decode_verified": False,
        "visual_quality_verified": False,
        "evidence_scope": "manifest_metadata_only",
    }


def normalize_candidate(candidate: dict) -> dict:
    item = dict(candidate)
    item.setdefault("access_state", "ACCESS_UNKNOWN")
    item.setdefault("reason", "No target response status or explicit public-access evidence was observed")
    item["collected_by"] = list(dict.fromkeys(
        source for source in item.get("collected_by", []) if source in ("spider", "browser", "fmhy")
    ))
    item["media_identity"] = item.get("media_identity") or infer_media_identity(
        item.get("title", ""), item.get("url", "")
    )
    item["quality_evidence"] = item.get("quality_evidence") or build_quality_evidence(item.get("validation"))
    declared = item["quality_evidence"].get("best_declared_resolution") or {}
    declared_height = declared.get("height") if isinstance(declared, dict) else None
    quality_hint = item["media_identity"].get("quality_hint")
    quality_rank = declared_height or {"4k": 2160, "2160p": 2160, "1080p": 1080, "720p": 720, "480p": 480}.get(quality_hint)
    item["quality_evidence"]["quality_rank"] = quality_rank
    item["quality_evidence"]["quality_rank_source"] = (
        "manifest_declared" if declared_height else ("filename_hint" if quality_hint else "unknown")
    )
    return item


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
            access = classify_access_state(url=absolute)
            found.setdefault(absolute, {"url": absolute, "kind": kind, "host": host, "title": title, **access})
            if len(found) >= limit:
                return list(found.values())
    # Public metadata and common player configuration attributes.
    for element in adaptive_css(page, "[data-src], [data-url], [data-play], [content], [data-config], [data-player]"):
        for attribute in ("data-src", "data-url", "data-play", "content", "data-config", "data-player"):
            value = (element.attrib.get(attribute) or "").strip()
            values = [value]
            if value.startswith(("{", "[")):
                try:
                    values.extend(extract_public_urls_from_json(json.loads(value)))
                except (ValueError, TypeError):
                    pass
            for candidate_url in values:
                if not candidate_url.startswith("https://"):
                    continue
                classified = classify_url(candidate_url)
                if classified:
                    kind, host = classified
                    found.setdefault(candidate_url, {"url": candidate_url, "kind": kind, "host": host, "title": title})
    # Inspect inline public player configuration only; never execute scripts or bypass access controls.
    for script in adaptive_css(page, "script"):
        script_text = (getattr(script, "text", "") or "").strip()
        if not script_text or len(script_text) > 512_000:
            continue
        for match in re.findall(r"""(?i)(?:file|src|url|playurl|play_url|video_url|hls|dash)\s*[:=]\s*["'](https://[^"'\s<>]+)["']""", script_text):
            classified = classify_url(match)
            if classified:
                kind, host = classified
                found.setdefault(match, {"url": match, "kind": kind, "host": host, "title": title})
    return list(found.values())[:limit]


def extract_public_urls_from_json(value, depth: int = 0) -> list[str]:
    """Extract only explicit public HTTPS media/player URLs from bounded JSON data."""
    if depth > 8:
        return []
    results: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            key_name = str(key).lower()
            if isinstance(item, str) and key_name in {
                "url", "src", "file", "playurl", "play_url", "video_url",
                "m3u8", "mp4", "hls", "dash", "player_url",
            } and item.startswith("https://"):
                results.append(item)
            elif isinstance(item, (dict, list)):
                results.extend(extract_public_urls_from_json(item, depth + 1))
    elif isinstance(value, list):
        for item in value[:500]:
            if isinstance(item, (dict, list)):
                results.extend(extract_public_urls_from_json(item, depth + 1))
    return results[:100]


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
        extracted_media: list[str] = []
        response_body = ""
        access = classify_access_state(
            getattr(response, "status", None),
            getattr(response, "headers", {}),
            "",
            url,
        )
        if kind == "public-api-response":
            try:
                body = response.body
                response_body = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body)
                access = classify_access_state(
                    getattr(response, "status", None),
                    getattr(response, "headers", {}),
                    response_body,
                    url,
                )
                payload = json.loads(response_body)
                data = payload.get("data") if isinstance(payload, dict) else None
                api_list = payload.get("list") if isinstance(payload, dict) else None
                if not isinstance(api_list, list) and isinstance(data, dict):
                    api_list = data.get("list")
                if isinstance(api_list, list):
                    kind = "cms-api-candidate"
                extracted_media = extract_public_urls_from_json(payload)
            except Exception:
                pass
        if kind and access["access_state"] == "PUBLIC":
            seen.add(url)
            results.append({"url": url, "kind": kind, "host": parsed.hostname.lower(), "title": "Captured browser network request", **access})
        elif access["access_state"] != "PUBLIC":
            seen.add(url)
            results.append({
                "url": url, "kind": "access-gate", "host": parsed.hostname.lower(),
                "title": "Provider access requirement detected", **access,
            })
        for media_url in extracted_media:
            classified_media = classify_url(media_url)
            if classified_media and media_url not in seen:
                media_kind, media_host = classified_media
                seen.add(media_url)
                results.append({
                    "url": media_url, "kind": media_kind, "host": media_host,
                    "title": "Extracted from public API player configuration",
                    **classify_access_state(url=media_url),
                })
        if len(results) >= limit:
            break
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

    def configure_sessions(self, manager) -> None:
        # Make the HTTP Spider's redirect policy explicit: never follow a
        # redirect into loopback, private, or link-local address space.
        manager.add("default", FetcherSession(follow_redirects="safe"))

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


def frontier_link_priority(target: str, anchor_text: str = "") -> int | None:
    """Rank same-site HTML navigation; return None for media/API/non-page targets."""
    parsed = urlparse(target)
    path = parsed.path.lower()
    if classify_url(target) or path.endswith((".pdf", ".zip", ".jpg", ".jpeg", ".png", ".webp")):
        return None
    signal = f"{path} {anchor_text.lower()}"
    if any(token in signal for token in ("next", "page=", "分页", "下一页", "更多")):
        return 20
    if any(token in signal for token in ("movie", "film", "vod", "video", "tv", "series", "anime", "category", "genre", "电影", "剧集", "动漫", "分类")):
        return 10
    if path in ("", "/") or path.count("/") <= 2:
        return 5
    return 1


class SpiderCandidateBatch(list):
    """List-compatible candidate result with explicit crawl diagnostics."""
    def __init__(self, values=(), diagnostics: dict | None = None):
        super().__init__(values)
        self.diagnostics = diagnostics or {}


def run_spider(url: str, limit: int) -> list[dict]:
    class TargetSiteSpider(SiteSpider):
        start_urls = [url]
        allowed_domains = [urlparse(url).hostname]
        pages_scheduled: set[str] = {url}
        pages_processed: set[str] = set()

        async def parse(self, response: Response):
            async for item in super().parse(response):
                yield item
            current = canonical_candidate_url(response.url)
            if current not in self.pages_processed:
                self.pages_processed.add(current)
            meta = getattr(response, "meta", {}) or {}
            try:
                depth = max(0, int(meta.get("crawl_depth", 0)))
            except (TypeError, ValueError):
                depth = 0
            if depth >= MAX_CRAWL_DEPTH or len(self.pages_scheduled) >= MAX_CRAWL_PAGES:
                return

            ranked: list[tuple[int, str]] = []
            for anchor in response.css("a"):
                href = (anchor.attrib.get("href") or "").strip()
                if not href:
                    continue
                target = urljoin(response.url, href)
                parsed = urlparse(target)
                if parsed.scheme != "https" or parsed.hostname != self.allowed_domains[0]:
                    continue
                target = canonical_candidate_url(target)
                if target in self.pages_scheduled:
                    continue
                priority = frontier_link_priority(target, text_of(anchor))
                if priority is not None:
                    ranked.append((priority, target))

            # Bounded priority frontier: pagination and catalogue/category links first.
            ranked.sort(key=lambda item: (-item[0], item[1]))
            page_budget = min(MAX_CRAWL_LINKS_PER_PAGE, MAX_CRAWL_PAGES - len(self.pages_scheduled))
            for priority, target in ranked[:page_budget]:
                self.pages_scheduled.add(target)
                yield response.follow(
                    target,
                    priority=priority,
                    meta={"crawl_depth": depth + 1},
                )
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
    stats = getattr(result, "stats", None)
    diagnostics = {
        "frontier_max_depth": MAX_CRAWL_DEPTH,
        "frontier_max_pages": MAX_CRAWL_PAGES,
        "pages_scheduled": len(TargetSiteSpider.pages_scheduled),
        "pages_processed": len(TargetSiteSpider.pages_processed),
        "requests_count": getattr(stats, "requests_count", None),
        "completed": getattr(result, "completed", None),
    }
    return SpiderCandidateBatch(candidates, diagnostics)


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


def canonical_candidate_url(raw_url: str) -> str:
    """Normalize URL identity without altering query parameters or access semantics."""
    parsed = urlparse(raw_url)
    host = (parsed.hostname or "").lower().rstrip(".")
    port = parsed.port
    netloc = host if port in (None, 443) else f"{host}:{port}"
    return parsed._replace(scheme="https", netloc=netloc, fragment="").geturl()


def merge_unique_candidates(existing: list[dict], incoming: list[dict], limit: int) -> list[dict]:
    """Merge by canonical URL and retain provenance from every collector."""
    if limit <= 0:
        return []
    merged: dict[str, dict] = {}
    for batch in (existing, incoming):
        for source in batch:
            item = dict(source)
            target = item.get("url")
            if not isinstance(target, str) or not target:
                continue
            key = canonical_candidate_url(target)
            item = normalize_candidate(item)
            if key not in merged:
                item["canonical_url"] = key
                item["collected_by"] = list(dict.fromkeys(item.get("collected_by", [])))
                if item.get("collector"):
                    item["collected_by"] = list(dict.fromkeys([*item["collected_by"], item["collector"]]))
                merged[key] = item
            else:
                current = merged[key]
                sources = [*current.get("collected_by", []), *item.get("collected_by", [])]
                if item.get("collector"):
                    sources.append(item["collector"])
                current["collected_by"] = list(dict.fromkeys(sources))
                if not current.get("title") and item.get("title"):
                    current["title"] = item["title"]
                if current.get("access_state") in (None, "ACCESS_UNKNOWN") and item.get("access_state") not in (None, "ACCESS_UNKNOWN"):
                    for field in ("access_state", "reason", "next_action", "drm_systems"):
                        if field in item:
                            current[field] = item[field]
    return list(merged.values())[:limit]


def run_browser_capture(url: str, limit: int) -> tuple[object, list[dict], dict]:
    # Browser rendering is a fallback for JavaScript-heavy pages. No CAPTCHA,
    # login, paywall, DRM or access-control bypass is attempted.
    with StealthySession(headless=True, record_requests=True, max_recorded_requests=300) as session:
        page = session.fetch(url, timeout=30, network_idle=True, page_setup=install_browser_request_guard)
        candidates = extract_candidates(page, url, limit)
        try:
            captured_requests = session.network.search(limit=None)
            captured_request_count = len(captured_requests)
        except Exception:
            captured_request_count = 0
        api_candidates = captured_api_candidates(session, url, max(0, limit - len(candidates)))
        page_title = ""
        css = getattr(page, "css", None)
        if callable(css):
            try:
                page_title = (css("title::text").get() or "").strip()[:200]
            except Exception:
                page_title = ""
        diagnostics = {
            "page_title": page_title,
            "final_url": str(getattr(page, "url", "") or url),
            "captured_request_count": captured_request_count,
        }
        return page, merge_unique_candidates(candidates, api_candidates, limit), diagnostics


def persist_task(task_id: str, url: str, host: str, mode: str, status: str, error: str | None = None, count: int = 0) -> None:
    with db() as connection:
        connection.execute(
            "UPDATE tasks SET status=?,updated_at=?,error=?,result_count=? WHERE id=?",
            (status, int(time.time()), error, count, task_id),
        )


def crawl_site(payload: CrawlRequest) -> dict:
    require_egress_firewall()
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
        spider_diagnostics = {"status": "skipped", "candidate_count": 0, "error": None}
        browser_diagnostics = {"status": "skipped", "candidate_count": 0, "error": None}
        page_title = ""
        final_url = raw_url
        captured_request_count = 0
        if payload.mode == "auto":
            # Run both collectors independently; one failure never suppresses the other.
            with ThreadPoolExecutor(max_workers=2, thread_name_prefix="scrapling-collector") as pool:
                spider_future = pool.submit(run_spider, raw_url, payload.limit)
                browser_future = pool.submit(run_browser_capture, raw_url, payload.limit)
                try:
                    spider_candidates = spider_future.result()
                    for item in spider_candidates:
                        item["collector"] = "spider"
                        item["collected_by"] = ["spider"]
                    candidates = merge_unique_candidates(candidates, spider_candidates, payload.limit)
                    spider_diagnostics.update({"status": "completed", "candidate_count": len(spider_candidates),
                                               **getattr(spider_candidates, "diagnostics", {})})
                except Exception as exc:
                    spider_diagnostics.update({"status": "failed", "error": type(exc).__name__})
                    errors.append(f"HTTP Spider: {type(exc).__name__}")
                try:
                    _, browser_candidates, browser_meta = browser_future.result()
                    for item in browser_candidates:
                        item["collector"] = "browser"
                        item["collected_by"] = ["browser"]
                    candidates = merge_unique_candidates(candidates, browser_candidates, payload.limit)
                    browser_diagnostics.update({"status": "completed", "candidate_count": len(browser_candidates)})
                    page_title = browser_meta["page_title"]
                    final_url = browser_meta["final_url"]
                    captured_request_count = browser_meta["captured_request_count"]
                except Exception as exc:
                    browser_diagnostics.update({"status": "failed", "error": type(exc).__name__})
                    errors.append(f"Browser capture: {type(exc).__name__}")
        elif payload.mode == "http":
            try:
                spider_candidates = run_spider(raw_url, payload.limit)
                for item in spider_candidates:
                    item["collector"] = "spider"
                    item["collected_by"] = ["spider"]
                candidates = merge_unique_candidates(candidates, spider_candidates, payload.limit)
                spider_diagnostics.update({"status": "completed", "candidate_count": len(spider_candidates)})
            except Exception as exc:
                spider_diagnostics.update({"status": "failed", "error": type(exc).__name__})
                errors.append(f"HTTP Spider: {type(exc).__name__}")
        elif payload.mode == "browser":
            try:
                _, browser_candidates, browser_meta = run_browser_capture(raw_url, payload.limit)
                for item in browser_candidates:
                    item["collector"] = "browser"
                    item["collected_by"] = ["browser"]
                candidates = merge_unique_candidates(candidates, browser_candidates, payload.limit)
                browser_diagnostics.update({"status": "completed", "candidate_count": len(browser_candidates)})
                page_title = browser_meta["page_title"]
                final_url = browser_meta["final_url"]
                captured_request_count = browser_meta["captured_request_count"]
            except Exception as exc:
                browser_diagnostics.update({"status": "failed", "error": type(exc).__name__})
                errors.append(f"Browser capture: {type(exc).__name__}")

        now = int(time.time())
        with db() as connection:
            for item in candidates[:payload.limit]:
                candidate_id = hashlib.sha256((task_id + item["url"]).encode()).hexdigest()[:32]
                connection.execute(
                    """INSERT OR IGNORE INTO candidates
                    (id,task_id,url,host,kind,title,status,created_at,collected_by,access_state,access_reason,probe_evidence,media_identity,quality_evidence)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (candidate_id, task_id, item["url"], item["host"], item["kind"], item.get("title", ""), "pending", now,
                     json.dumps(item.get("collected_by", []), ensure_ascii=False),
                     item.get("access_state", "ACCESS_UNKNOWN"), item.get("reason"),
                     json.dumps(item.get("probe_evidence", {}), ensure_ascii=False),
                     json.dumps(item.get("media_identity", {}), ensure_ascii=False),
                     json.dumps(item.get("quality_evidence", {}), ensure_ascii=False)),
                )
                item["id"] = candidate_id
                item["status"] = "pending"
            connection.execute(
                "UPDATE tasks SET status=?,updated_at=?,error=?,result_count=? WHERE id=?",
                ("partial" if errors and candidates else ("failed" if errors else "completed"), now, "; ".join(errors) or None, len(candidates), task_id),
            )
        task_status = "partial" if errors and candidates else ("failed" if errors else "completed")
        return {"task_id": task_id, "status": task_status,
                "page_url": raw_url, "final_url": final_url, "page_title": page_title,
                "mode": payload.mode, "engine": "Scrapling Spider + StealthySession",
                "count": len(candidates), "captured_request_count": captured_request_count,
                "diagnostics": {"http_spider": spider_diagnostics, "browser": browser_diagnostics},
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
    require_egress_firewall()
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
    candidates = []
    for row in rows:
        item = dict(row)
        for field, fallback in (
            ("collected_by", []), ("probe_evidence", {}),
            ("media_identity", {}), ("quality_evidence", {}),
        ):
            try:
                item[field] = json.loads(item.get(field) or json.dumps(fallback))
            except (TypeError, ValueError):
                item[field] = fallback
        item["access_state"] = item.get("access_state") or "ACCESS_UNKNOWN"
        candidates.append(item)
    return {"candidates": candidates}


@app.post("/v1/candidates/{candidate_id}/validate")
def validate_candidate(candidate_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    require_egress_firewall()
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
            access = classify_access_state(page.status, page.headers, body.decode("utf-8", errors="replace"), raw_url)
            validation.update({"reachable": 200 <= page.status < 400, "json": isinstance(parsed, dict),
                               "cms_shape": cms_shape,
                               "sample_count": len(cms_list) if isinstance(cms_list, list) else 0,
                               "content_type": content_type, "http_status": page.status,
                               "access": access})
            candidate_status = "validated" if cms_shape and access["access_state"] == "PUBLIC" else "rejected"
        except Exception as exc:
            validation.update({"reachable": False, "error": type(exc).__name__})
            candidate_status = "rejected"
    elif candidate["kind"] == "direct-media":
        throttle(host)
        probe = probe_direct_media(raw_url)
        hls_encryption_signal = ""
        if probe.get("media_format") == "hls":
            methods = [
                method for method in (probe.get("encryption_methods") or [])
                if str(method).upper() != "NONE"
            ]
            formats = probe.get("key_formats") or []
            signals = [f"#EXT-X-KEY:METHOD={method}" for method in methods]
            signals.extend(f"#EXT-X-KEY:KEYFORMAT={key_format}" for key_format in formats)
            hls_encryption_signal = "\\n".join(signals)
        access = classify_access_state(
            probe.get("http_status"),
            {"content-type": probe.get("content_type", "")},
            hls_encryption_signal,
            raw_url,
        )
        validation.update({
            "playback_probe": "range_header_probe",
            **probe,
            "access": access,
            "note": "HTTP/media headers were checked with a bounded request. This does not guarantee full playback; verify in PlayerShell.",
        })
        segment_probe = None
        variant_tree_probe = None
        if probe.get("media_format") == "hls":
            if probe.get("is_master_playlist"):
                variant_tree_probe = probe_hls_variant_tree(probe)
                validation["variant_tree_probe"] = variant_tree_probe
            elif probe.get("segment_uris"):
                segment_probe = probe_hls_segments(probe["segment_uris"])
                validation["segment_probe"] = segment_probe
        references_safe = probe.get("rejected_reference_count", 0) == 0
        samples_passed = (
            not segment_probe
            or (segment_probe.get("sampled", 0) > 0 and segment_probe.get("failed", 0) == 0)
        )
        variants_passed = (
            not variant_tree_probe
            or variant_tree_probe.get("reachable_leaf_count", 0) > 0
        )
        candidate_status = (
            "validated"
            if probe.get("reachable") and access.get("access_state") == "PUBLIC"
            and references_safe and samples_passed and variants_passed
            else "rejected"
        )
    else:
        validation.update({
            "reachable": None,
            "playback_probe": "not_performed",
            "note": "Public URL and candidate type were checked. Embedded player content still requires manual playback verification; this is not a CMS API source.",
        })
    quality_evidence = build_quality_evidence(validation)
    observed_access = validation.get("access") or {}
    observed_state = observed_access.get("access_state") or candidate.get("access_state") or "ACCESS_UNKNOWN"
    observed_reason = observed_access.get("reason") or candidate.get("access_reason")
    with db() as connection:
        connection.execute(
            """UPDATE candidates SET status=?,validation=?,access_state=?,access_reason=?,
               probe_evidence=?,quality_evidence=? WHERE id=?""",
            (candidate_status, json.dumps(validation, ensure_ascii=False),
             observed_state, observed_reason,
             json.dumps(validation, ensure_ascii=False),
             json.dumps(quality_evidence, ensure_ascii=False), candidate_id),
        )
    return {"candidate_id": candidate_id, "validation": validation}
