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

POST /v1/spider accepts {"urls": ["https://public.example/"]} (1–20 seed URLs). Add an optional task_id (1–64 letters, digits, _ or -) to enable Scrapling's on-disk checkpoint directory. Reusing the same task ID and seed configuration allows the upstream Spider checkpoint to be resumed after a graceful interruption. Checkpoint files are stored under CRAWL_DATA_DIR (default ./crawl_data). The endpoint validates every seed, deduplicates URLs, obeys robots.txt, limits concurrency, and returns extracted page text plus Scrapling crawl statistics. It intentionally does not follow page links yet: browser subrequests, redirects, and DNS rebinding need deployment-level egress enforcement before recursive crawling is enabled. The HTTP API does not yet provide a job registry or a remote pause button; those remain planned.

Browser-backed fetchers require the optional browser dependencies and browser installation described by the upstream Scrapling documentation. Keep the service bound to localhost until authentication and deployment hardening are configured.

## Safety boundary

- Phase 1 does not crawl FMHY yet; FMHY directory ingestion is Phase 2.
- Only public HTTP(S) pages are in scope. No DRM, paywall, login or access-control circumvention.
- Respect robots.txt, rate limits and site terms. Do not treat a discovered website URL as a playable source.
- The service rejects localhost, private, link-local and reserved IP destinations to reduce SSRF risk.

## Verification

Run `pytest` and `ruff check .`. Network-dependent tests are opt-in and must use a controlled public test target.
