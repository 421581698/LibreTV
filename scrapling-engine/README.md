# LibreTV Scrapling Engine — Phase 1

An independently runnable Python service that hosts the upstream Scrapling framework for LibreTV. This phase validates the crawler engine only; it does not modify the LibreTV UI, production deployment, or main branch.

## Scope

The engine is built on the complete upstream `D4Vinci/Scrapling` package. It does not fork or replace Scrapling with a reduced implementation.

The eight capability areas are:

1. Fetching: HTTP, async, dynamic-browser and stealth fetchers.
2. Extraction: CSS, XPath, text, regex and DOM traversal.
3. Adaptive parsing: saved element fingerprints and relocation after layout changes.
4. Browser automation: JavaScript rendering, sessions and browser interactions.
5. Spider crawling: seed-URL jobs run through Scrapling Spider with concurrency limits and robots.txt enforcement. The PostgreSQL DAG worker also supports bounded, same-origin breadth-first link discovery through the DNS-pinning egress proxy; arbitrary cross-origin expansion remains disabled. Persistent pause, resume, cancellation, leases and audit events are available in PostgreSQL mode.
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
python -m app
```

Open `http://127.0.0.1:8787/health`.

The fetch API supports `adaptive_css` and `adaptive_xpath` in addition to ordinary selectors. First call with `adaptive_action: "save"` to persist an element fingerprint; later call with `adaptive_action: "relocate"` to let Scrapling find the matching element after the site's DOM changes. Adaptive fingerprints use Scrapling's SQLite storage at `CRAWL_DATA_DIR/adaptive.sqlite3` and are isolated by page domain.

POST /v1/spider remains a synchronous compatibility endpoint. For managed work, POST /v1/jobs accepts 1–20 seed URLs and returns a task_id; GET /v1/jobs/{task_id} returns persistent status; GET /v1/jobs/{task_id}/events streams persisted events over SSE. In SQLite mode, the API process schedules jobs locally and retains the local pause/resume controls. In PostgreSQL mode, the API only accepts and reports jobs; independent workers claim them with PostgreSQL row-lock leases. The PostgreSQL schema is initialized by both the API and workers. Queued jobs remain available after restarts, and expired running leases can be reclaimed by another worker. A task_id is immutable with respect to its seed URL list. Scrapling checkpoints live under CRAWL_DATA_DIR (default ./crawl_data), which must be a shared durable volume mounted at the same path in the API and every worker. Resume from an interrupted job requires a persisted Scrapling checkpoint file. The async Spider stream avoids Spider.start() and its process signal handlers. The crawler obeys robots.txt, limits concurrency and per-domain requests, uses an explicit service User-Agent without stealth headers or TLS browser impersonation, and does not recursively follow page links yet. max_response_bytes is checked after Scrapling receives the response body; it is not a network-transfer memory cap. The crawler's HTTP(S) clients use a dedicated DNS-pinning egress proxy that resolves every destination, rejects non-public or mixed DNS answers, and connects to the validated IP. Redirects are re-issued through the proxy and validated again. Worker and engine containers have no direct external network route; browser subrequest interception and stealth browser sessions remain disabled.

Run one Uvicorn API process per deployment instance and run independent workers with unique IDs using `libretv-scrapling-worker --worker-id worker-a`. Multiple PostgreSQL workers can compete safely for queued jobs; each renews its lease and fences result/completion writes by current lease ownership. If a worker loses its lease, late writes are rejected. The API must be configured with DATABASE_URL and workers must use the same database. PostgreSQL mode persists pause/cancel control requests for the lease-owning worker to observe and apply; paused jobs can be resumed through the API after a saved checkpoint is present. Control requests are recorded in the event stream. Cancellation is terminal. SQLite mode retains its original in-process pause behavior; the cancel endpoint is PostgreSQL-worker-only. Keep local development bound to localhost. The Docker image binds to 0.0.0.0 using the same HOST and PORT settings as the application, so it must be started with a SCRAPLING_API_KEY of at least 32 characters. Any non-loopback bind without this key fails closed; all /v1/* routes then require the matching X-API-Key header. Terminate TLS at a trusted reverse proxy; do not send the API key over plain public HTTP. This is a single service key, not per-user tenant isolation. Before a multi-user remote deployment, add per-user authorization/quotas, audit retention, and network-level egress filtering that blocks private, loopback, link-local and metadata-service ranges even after DNS resolution and redirects.


## Optional Docker Compose deployment

The root `docker-compose.yml` includes an opt-in `crawler` profile with PostgreSQL, the Scrapling API, the legacy crawl-job worker, the DAG workflow worker, a DNS-pinned egress proxy, and a dedicated media-probe sidecar. It does not start as part of the default LibreTV Compose deployment.

Set `SCRAPLING_API_KEY` to at least 32 random characters and `SCRAPLING_DB_PASSWORD` to a separate strong password in the root `.env`, then start the profile:

```bash
docker compose --profile crawler up -d --build
```

LibreTV reaches the engine over the internal Compose network at `http://scrapling-engine:8787`; the engine port is not published to the host. PostgreSQL data and shared crawl checkpoint data use named volumes. The engine refuses to bind to `0.0.0.0` without its API key. Change the example development database password before any non-local deployment, terminate TLS at the public edge, and keep the engine and database private.

## Durable server-side DAG runtime

PostgreSQL mode also exposes a persistent DAG API. POST /v1/workflows accepts a workflow_id (optional), nodes, directed edges, and input metadata. The API rejects duplicate node IDs, unknown edge endpoints, self-edges, and cycles. GET /v1/workflows/{workflow_id} returns node states and graph edges; GET /v1/workflows/{workflow_id}/events streams the durable audit log. POST /v1/workflows/{workflow_id}/control accepts `pause`, `resume`, or `cancel`. Pause and cancellation stop new node claims immediately and settle active work at node boundaries; expired leases are reconciled by the worker. Resume re-queues eligible pending nodes. Control requests and final state transitions are recorded in the workflow event log.

Start independent DAG executors with `libretv-workflow-worker --worker-id dag-worker-a`. The runtime claims only nodes whose dependencies are completed, uses PostgreSQL leases and heartbeats, fences completion writes by lease owner, and retries failed nodes up to each node's max_attempts. Built-in node types are `validate_public_urls`, `crawl_seed_urls`, `discover_site_links`, `ai_supervisor_discover`, `generate_extraction_rule`, `register_candidates`, `analyze_media_manifest`, `analyze_media_candidates`, and `probe_media_candidates`. The candidate stage stores deduplicated media references with page evidence; the media stage fetches and inspects HLS/DASH manifests. Node retries currently rerun the node from its beginning; per-node checkpoint/resume is not yet implemented.

Example workflow:

```json
{
  "workflow_id": "site-discovery-001",
  "nodes": [
    {
      "node_id": "validate",
      "node_type": "validate_public_urls",
      "input": {"urls": ["https://example.com/"]}
    },
    {
      "node_id": "crawl",
      "node_type": "discover_site_links",
      "input": {"max_pages": 50, "max_depth": 2, "max_links_per_page": 30}
    },
    {
      "node_id": "candidate-review",
      "node_type": "register_candidates",
      "input": {}
    },
    {
      "node_id": "media-analysis",
      "node_type": "analyze_media_candidates",
      "input": {}
    },
    {
      "node_id": "bitstream-probe",
      "node_type": "probe_media_candidates",
      "input": {}
    }
  ],
  "edges": [
    ["validate", "crawl"],
    ["crawl", "candidate-review"],
    ["candidate-review", "media-analysis"],
    ["candidate-review", "bitstream-probe"]
  ]
}
```

The DAG engine is now a real durable orchestration primitive, not yet the complete AI Supervisor. Completed parent outputs are injected into each dependent node under its `dependencies` input, and the built-in crawl node can consume validated URLs from its predecessor. The `register_candidates` node stores only discovered direct media URLs as deduplicated candidate records with append-only page evidence; ordinary HTML pages are not mislabeled as playable sources. The `analyze_media_candidates` node safely fetches HLS/DASH manifests and records rendition resolution, advertised bitrate, frame rate, codec, and HDR transfer-range claims. The `probe_media_candidates` node streams up to five direct-file candidates per node through the validated egress proxy (maximum 2 GiB per file), stages them in a shared volume, and invokes ffprobe only through the isolated no-network sidecar. The sidecar has no database or collector network access, reads staging and request volumes read-only, and writes only probe results. Bitstream dimensions and color metadata are recorded as evidence; native mastering and visual quality are not claimed. GET /v1/candidates and GET /v1/candidates/{candidate_id} expose the review queue. POST /v1/candidates/{candidate_id}/review records an explicit approved/rejected decision and reviewer evidence; this decision does not publish or write to LibreTV's formal resource registry. GET /v1/rules and GET /v1/rules/{rule_id} expose tested selectors and their evidence. POST /v1/rules/{rule_id}/activate and POST /v1/rules/{rule_id}/disable require an authenticated administrator identity and append a rule status event. Rules are versioned per source origin and extraction goal; model-generated rules remain tested but inactive until a human activates them. The control-center proxy requires a valid LibreTV login for this action and rejects review when authentication is disabled. Manifest claims are not proof of native 4K: native resolution and upscaling remain unverified without inspecting the actual media bitstream. Direct MP4/WebM probing is handed off through a dedicated staging volume plus separate request/result volumes to a separate ffprobe sidecar. The sidecar runs as UID 10001 with a read-only root filesystem, no network namespace, bounded CPU/memory/PIDs, read-only staging and request mounts, and a separate writable result volume; it receives no database URL, API key or crawler network. The workflow worker copies only a staged file into the shared staging volume, which the sidecar mounts read-only, then stores the returned report in the candidate record. The `discover_site_links` DAG node now performs bounded breadth-first discovery on the seed origin only. Its limits are configurable per node (1–200 pages, depth 0–5, up to 50 links per page); it respects robots.txt, revalidates discovered URLs, removes fragments, deduplicates links, and refuses cross-origin redirects. It does not yet perform browser-rendered discovery, cross-origin expansion, or network API capture. In the crawler Compose profile, the dedicated egress proxy re-resolves and validates all A/AAAA answers for each new origin connection, then connects to a validated IP literal; workers are attached only to internal Docker networks and cannot bypass the proxy. Keep this topology intact when deploying; any future browser or network-capable component must use the same enforced egress path. The `ai_supervisor_discover` node can call an optional OpenAI-compatible model configured with `SUPERVISOR_API_BASE`, `SUPERVISOR_API_KEY`, and `SUPERVISOR_MODEL` in the root `.env`; the Compose profile passes these settings to the API and workflow worker. The model receives the task goal and validated seed URLs and may return only a typed discovery-limit plan; the worker validates those bounds and executes the existing `discover_site_links` tool. It cannot emit code, arbitrary URLs, shell commands, or cross-origin actions. When the model is configured, the control-center workflow uses `ai_supervisor_discover` to choose bounded same-origin crawl limits, then `generate_extraction_rule` proposes one CSS/XPath selector from a bounded HTML sample and executes it against the fetched page. Empty matches are rejected. Each passing selector is stored as an inactive, versioned rule with sample evidence. Only an authenticated administrator can activate it; subsequent discovery applies only active rules for that exact source origin and attaches their extracted values to candidate evidence. Successful selectors are saved to the PostgreSQL rule registry with per-goal version numbers, append-only test evidence, and status history. A newly tested version remains inactive and never replaces an existing active version automatically; an authenticated administrator must explicitly activate it. An authenticated administrator can disable or restore a version with an audit event. This rule lifecycle is separate from formal resource publication, which still requires explicit human approval. Automatic selector self-repair and rollback are not yet implemented. A new tested version does not silently replace an active version; a human must activate it, at which point the previous active version is disabled with an audit event.

## Container runtime acceptance

The Scrapling Engine CI runs `scripts/verify-crawler-containers.sh` on an isolated GitHub-hosted Docker runner. It builds and starts the opt-in crawler services, then checks the effective container configuration and runtime identity for the API and both workers: UID/GID 10001, read-only root filesystem, dropped capabilities, no-new-privileges, PID/CPU/memory limits, and a `/tmp` tmpfs mounted with `noexec,nosuid,nodev`. It also performs an actual write/delete operation on the shared `/data` volume as UID 10001 and checks that the media-probe sidecar uses `network_mode: none`, mounts its staging and request volumes read-only, uses a separate writable result volume, and cannot open an outbound TCP connection.

This is a reproducible CI runtime acceptance on a GitHub-hosted Docker runner, not evidence that a user's own Docker host has been tested. The sidecar handoff is exercised end to end with a generated media clip and a real ffprobe report. The same acceptance checks that workers cannot reach a public IP directly, can fetch HTTP and HTTPS through the proxy, that metadata-address CONNECT requests are rejected, and that the proxy is the only crawler service attached to an external network.

## DNS-pinned egress path

The crawler Compose profile places the API and workers only on internal Docker networks. PostgreSQL is on a separate internal database network. Workers have no default bridge route; their HTTP(S) traffic and configured Supervisor requests use `scrapling-egress-proxy`, which is the only crawler component attached to the external egress bridge. Compose sets `SCRAPLING_REQUIRE_EGRESS_PROXY=true`; engine and worker processes fail startup if the proxy URL is missing.

The proxy supports HTTP GET/HEAD and HTTPS CONNECT. For every new target connection it resolves the hostname, rejects the request if any A/AAAA answer is not globally routable, and opens the socket to one of the validated IP literals rather than resolving the hostname again. HTTPS remains end-to-end TLS: the proxy does not terminate TLS, so the client's original SNI and certificate validation remain intact. Redirects are followed by the client; each new origin connection returns through the proxy and is independently resolved and checked. Same-connection keep-alive traffic remains pinned to the already validated peer.

This closes the DNS check-to-connect gap for the configured Scrapling Fetcher, Spider, robots fetches, and Supervisor HTTP client when running in the Compose profile. It is not a general-purpose browser egress gateway: browser subresource fetching is not enabled, and any future network-capable component must be explicitly routed through this proxy or isolated on a network with no external route. Do not attach workers to the default bridge network.

## Safety boundary

- Phase 1 does not crawl FMHY yet; FMHY directory ingestion is Phase 2.
- Only public HTTP(S) pages are in scope. No DRM, paywall, login or access-control circumvention.
- Respect robots.txt, rate limits and site terms. Do not treat a discovered website URL as a playable source.
- The service rejects localhost, private, link-local and reserved IP destinations to reduce SSRF risk.

## Verification

Run `pytest` and `ruff check .`. The CI workflow starts PostgreSQL 16 and runs the PostgreSQL persistence integration test in addition to the SQLite unit tests. CI verifies unit/API behavior without relying on arbitrary public targets. CI also runs a controlled public-site smoke test against example.com through both the HTTP Fetcher and async Spider; broader target-site acceptance remains a separate step.
