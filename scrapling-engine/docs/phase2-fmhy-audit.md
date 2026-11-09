# Phase 2 FMHY Catalog Audit

Audit target: feature/fmhy-resource-directory-phase2

Scope: read-only review of the current FMHY importer, SQLite catalog store, read/sync APIs, and tests. This document records implementation gaps; it does not claim live-site availability checks or production readiness.

## Already implemented

- FMHY official repository is the sole catalog discovery authority.
- The importer resolves an immutable upstream commit and reads the official source-file manifest at that revision.
- Source downloads are bounded by per-file size and concurrency limits and do not follow redirects.
- Markdown entries retain source file, line, revision URL, section path, marker, safety status, and original/canonical links.
- SQLite stores versioned snapshots, entries, links, and a host index.
- Unsafe-list entries are hidden by default in entry, domain, and category queries.
- Read APIs expose snapshot, categories, entries, and domains.
- Sync is serialized in-process and a failed/empty import does not replace the previous snapshot.

## Findings requiring work

### P0 — URL and domain identity

1. The current canonicalizer rejects every non-default port. This drops otherwise valid public resources such as https://example.org:8443/.
2. IPv6 public literals are not serialized with brackets when constructing the canonical URL authority. The parser may therefore produce an invalid canonical URL for a valid IPv6 address.
3. Host identity is currently exact-host only. www.example.org and example.org remain separate, and there is no explicit alias/redirect relationship model.
4. Do not blindly collapse all subdomains to an eTLD+1: services such as drive.example.org and media.example.org may be distinct. Add a registrable-domain/alias layer with public-suffix data and preserve every original host.

Acceptance: normalize scheme-default ports; preserve valid non-default ports; serialize IPv6 authorities correctly; add explicit domain_aliases or equivalent without deleting original host identities; cover IDNA, trailing dots, fragments, credentials, local/reserved IPs, and mixed-case hosts in tests.

### P0 — Resource role and category quality

1. The parser derives the top-level category from the Markdown filename. This is useful source taxonomy, but does not prove the actual service is a video, anime, music, or playable source.
2. Link roles are inferred from labels and a small host list. Unknown labels and host patterns can be misclassified.
3. Mirror/alternate relationships are not stored as a first-class group; current role labels alone cannot reliably tell whether two hosts are mirrors of one service.
4. Add a curated, revision-pinned sample audit across video, video-tools, audio, downloading, reading, and unsafe sources. Record precision/recall findings before changing heuristics.

Acceptance: preserve the FMHY source category separately from any later inferred media type; unknown roles remain unclassified; mirror groups include provenance and confidence; regression fixtures cover representative official Markdown lines.

### P0 — Health and safety status

1. All ordinary FMHY entries are correctly marked unverified; there is no actual website health probe or playback verification yet.
2. There is no persisted observation model for HTTP status, redirect chain, timeout, robots decision, DNS result, checked time, or failure reason.
3. URL parsing rejects local/reserved IP literals, but a catalog entry is not a safe-to-fetch authorization. Every future crawl must resolve and validate the destination at connection time and enforce network egress restrictions against DNS rebinding, redirects, private ranges, and metadata services.
4. No bulk probing of the full host inventory should be enabled until rate limits, robots policy, allow/deny rules, and egress enforcement are in place.

Acceptance: separate discovery state from health state and playback state; store append-only observations with timestamps; revalidate every redirect and resolved address at fetch time; never promote a site to playable solely because it returns HTTP 200.

### P1 — Snapshot and API behavior

1. Entry and domain endpoints return the number of rows in the current page as count; callers cannot distinguish page size from total matching results. Add total_count while retaining page count if compatibility requires it.
2. Search uses substring matching against title/domain only. Add explicit search semantics and indexes after measuring catalog query performance.
3. The historical catalog_domains table is global across snapshots, while the API uses the snapshot-scoped link index. Document this distinction and add tests for domain history across multiple snapshots.
4. The sync lock is process-local. The README requires one Uvicorn worker; keep that restriction explicit until a cross-process lock is implemented.
5. Add tests for repeated identical syncs, changed upstream revisions, removed entries, concurrent sync requests, rollback on database errors, and pagination totals.

### P1 — Parser regression coverage

Add fixtures for escaped Markdown delimiters, nested labels, reference-style links, autolinks, images, mixed fence types, malformed links, Unicode/IDNA hosts, query-bearing URLs, and duplicate links. Keep original URLs and source-line attribution even when canonical identity is shared.

### P1 — Real collection workflow (next phase boundary)

The current FMHY sync imports a directory; it does not schedule crawls of discovered websites. There is no end-to-end FMHY-to-Spider queue, crawl policy record, persistent collection result, discovered public API record, resource review workflow, or resource CRUD/export surface yet.

These are not bugs in the directory importer; they are the next controlled integration layer. Implement them only after the directory identity and safety rules above are accepted. Do not wire the settings UI before the backend task/result contracts exist.

## Current boundary

- Phase 1 Scrapling engine is treated as complete for its agreed scope.
- Phase 2 FMHY directory importer and read APIs exist, but the quality/security acceptance items above remain open.
- The service does not crawl all FMHY websites; it only queues explicitly selected primary entries. It does not verify playable media or feed resources into LibreTV.
- No main-branch merge or production deployment is part of this audit.


## Implementation update — 2026-11-09

The first controlled FMHY-to-Scrapling collection slice is now implemented on the feature branch:

- `POST /v1/catalog/crawl` accepts up to 20 selected FMHY entry IDs and an optional snapshot ID.
- The catalog store resolves only each selected entry's primary link, rejects unsafe entries and entries without a primary resource, and retains source-file/line/revision provenance in the job's `catalog_selection` event.
- Selected seeds enter the existing persistent Scrapling job queue; job status, result rows, pause/resume controls, and SSE events remain the existing managed-job contract.
- Scrapling Spider results now include title, poster candidate, same-host detail/playback page links, and media candidates found in media elements, iframe player elements, and inline scripts.
- Media candidate types include HLS/M3U8, MP4, DASH/MPD, WebM, generic video elements, and extensionless player embeds. Every candidate is explicitly marked `pending_fetch_validation`; discovery does not mean reachable, authorized, or playable.
- Public non-default ports are accepted by the URL guard; IPv6 authorities are bracketed in canonical URLs. Regression tests were added for these cases.
- The project dependency floor has been migrated to upstream Scrapling v0.5.1 (`>=0.5.1,<0.6`). The upstream v0.5 network capture API is session-based (`record_requests=True` plus `session.network.search(...)`), not the removed `capture_xhr` / `response.captured_xhr` API. Network capture is still gated and not claimed as implemented.

### Still not complete

1. The current Spider still fetches selected seed pages only. It records discovered detail/playback page links but does not yet enqueue them recursively.
2. Candidate media URLs are not yet fetched and validated as media resources. There is no persisted media-specific validation observation (HTTP status, content type, redirect chain, byte-range support, playlist parse result, codec/resolution evidence).
3. There is no real playback verification and no resource promotion/review workflow. No candidate is currently eligible for the LibreTV player.
4. Dynamic browser collection and Scrapling v0.5.1 network-history capture remain disabled until browser subrequest/redirect egress enforcement and per-request URL policy are implemented.
5. Domain alias/mirror relationship modeling, catalog pagination totals, parser coverage, cross-process sync locking, and full health observation history remain open audit items.

### Current honest status

FMHY selected entries can now create persistent Scrapling seed-crawl jobs, and seed-page results can expose candidate movie pages and media URLs. This is a first end-to-end discovery slice, not a completed automatic media acquisition pipeline. The remaining path is: safe follow-up page scheduling → candidate fetch validation → HLS/DASH/MP4 inspection → playback verification → review/promotion → later LibreTV player integration. No main merge or production deployment is included.
