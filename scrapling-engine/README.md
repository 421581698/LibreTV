# LibreTV Scrapling Engine — Phase 1

An independently runnable Python service that hosts the upstream Scrapling framework for LibreTV. This phase validates the crawler engine only; it does not modify the LibreTV UI, production deployment, or main branch.

## Scope

The engine is built on the complete upstream `D4Vinci/Scrapling` package. It does not fork or replace Scrapling with a reduced implementation.

The eight capability areas are:

1. Fetching: HTTP, async, dynamic-browser and stealth fetchers.
2. Extraction: CSS, XPath, text, regex and DOM traversal.
3. Adaptive parsing: saved element fingerprints and relocation after layout changes.
4. Browser automation: JavaScript rendering, sessions and browser interactions.
5. Spider crawling: the first integration exposes a seed-URL crawl endpoint backed by Scrapling Spider, with concurrency limits and robots.txt enforcement. Recursive link discovery and persistent job controls remain gated until request-level egress protection is in place.
6. Public API discovery: capture and inspect page network responses; never assume every endpoint is public or usable.
7. Network resilience: proxy configuration, retries, blocked-response handling, throttling and robots policy.
8. AI integration: upstream MCP server/Agent Skill plus a controlled LibreTV adapter surface.

Some orchestration features (job persistence, API auth, audit logs, policy enforcement and metrics) are service-layer responsibilities, not claims that Scrapling provides them automatically.

## Run locally

```bash
cd scrapling-engine
python -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --host 127.0.0.1 --port 8787
```

Open `http://127.0.0.1:8787/health`.

POST /v1/spider remains a synchronous compatibility endpoint. For managed work, POST /v1/jobs accepts 1–20 seed URLs and returns a task_id; GET /v1/jobs/{task_id} returns persistent status; POST /v1/jobs/{task_id}/pause and /resume control the live Spider; GET /v1/jobs/{task_id}/events streams persisted events over SSE. Job metadata and audit events are stored in SQLite (CRAWL_JOB_DATABASE_PATH, default ./crawl_data/jobs.sqlite3), while Scrapling checkpoints live under CRAWL_DATA_DIR (default ./crawl_data). A task_id is immutable with respect to its seed URL list. On process restart, unfinished jobs are marked interrupted; resume is allowed only when a checkpoint file exists. The async Spider stream avoids calling Spider.start() and its process signal handlers from a worker thread. The crawler obeys robots.txt, limits concurrency and per-domain requests, and does not recursively follow page links yet. Browser subrequests, redirect destinations and DNS rebinding still require deployment-level egress enforcement before recursive or browser crawling is enabled.

Browser-backed fetchers require the optional browser dependencies and browser installation described by the upstream Scrapling documentation. Keep the service bound to localhost. The job and fetch APIs do not yet include user authentication or tenant isolation; do not expose this service to the public internet. Before any remote deployment, add authentication/authorization, per-user quotas, audit retention, and network-level egress filtering that blocks private, loopback, link-local and metadata-service ranges even after DNS resolution and redirects.

## Safety boundary

- Phase 1 does not crawl FMHY yet; FMHY directory ingestion is Phase 2.
- Only public HTTP(S) pages are in scope. No DRM, paywall, login or access-control circumvention.
- Respect robots.txt, rate limits and site terms. Do not treat a discovered website URL as a playable source.
- The service rejects localhost, private, link-local and reserved IP destinations to reduce SSRF risk.

## Verification

Run `pytest` and `ruff check .`. CI verifies unit/API behavior without relying on arbitrary public targets. A separate controlled public-site smoke test is still required before declaring real-world crawling accepted.
