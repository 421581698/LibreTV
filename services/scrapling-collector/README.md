# LibreTV FMHY / Scrapling Collector

Scrapling is a Python crawling framework, so the collector runs as an isolated Python service. LibreTV calls it through the authenticated Next.js API proxy; the browser never receives the collector token.

## End-to-end pipeline

1. **Discover** — the only site directory is FMHY Movies / TV / Anime: https://fmhy.net/video. Discovered hosts are stored in SQLite.
2. **Fetch** — Scrapling Spider crawls the selected FMHY-discovered host with a bounded same-host page budget, per-domain delay, robots.txt compliance, and a persistent crawl checkpoint.
3. **Adapt** — Scrapling adaptive selectors save element traits by domain and try to relocate matching elements after page markup changes.
4. **Render / capture** — when HTTP collection finds no candidates, or browser mode is explicitly selected, StealthySession renders JavaScript and records public text-based network responses. JSON responses with a CMS-like `list` shape are surfaced as CMS API candidates.
5. **Classify** — public HTTPS candidates are separated into direct media, embedded player, and CMS API candidates.
6. **Validate** — candidates are DNS/public-IP checked. CMS API candidates are fetched and must return JSON with a list-shaped payload before they can be imported.
7. **Import / play** — validated CMS API endpoints can be added to LibreTV's existing custom VOD source store. Direct media candidates are previewed through the existing PlayerShell; they are not misrepresented as CMS sources.
8. **Track / recover** — SQLite stores discovery entries, tasks, candidates, validation results, and task status. Interrupted tasks are marked on service restart and can be retried from Settings → Resource Collection Center.

The collector accepts only HTTPS targets on standard port 443 and checks DNS results for public IP addresses before crawling. Browser capture also installs a per-request guard that rejects non-HTTPS, non-standard-port, unresolved, private, and reserved targets, including redirects and subresource requests. These application checks are defense in depth, not a complete network boundary: DNS can change between validation and connection (TOCTOU). The default Docker Compose bridge network does not enforce outbound destination filtering. Production deployments must additionally apply network-level egress controls (or a trusted egress proxy) that block loopback, private, link-local, reserved, and cloud-metadata ranges for every collector/browser process. Do not expose the collector directly to the public internet without HTTPS and a strong token. The collector does not log in, bypass paywalls, DRM, CAPTCHA or access controls. It does not automatically import unvalidated links. A URL being public or returning media bytes does not prove that the content is licensed or suitable for redistribution; operators must ensure they have permission to access and use each source.

## Run locally with Docker Compose

Create a strong token and add it to the LibreTV deployment's environment:

```sh
export SCRAPLING_API_TOKEN="$(openssl rand -hex 32)"
export SCRAPLING_API_BASE="http://scrapling-collector:8000"
docker compose --profile collector up -d --build
```

The collector is internal to the Compose network and persists its SQLite database in the `scrapling_data` named volume. The LibreTV container receives the same token and internal service URL from Compose.

For Cloudflare-hosted LibreTV, the collector must run as a separately reachable HTTPS service. Configure `SCRAPLING_API_BASE` and `SCRAPLING_API_TOKEN` as Worker environment values/secrets. Do not expose the collector without a strong token and HTTPS.

## API

- `GET /health` — service health and stored task count.
- `GET /v1/discover` — refresh FMHY's video directory and persist discovered sites.
- `POST /v1/crawl` — crawl one previously discovered host. Body: `{"url":"https://...","mode":"auto|http|browser","limit":50}`.
- `GET /v1/tasks` — recent persistent task history.
- `GET /v1/tasks/{task_id}/candidates` — candidates for one task.
- `POST /v1/tasks/{task_id}/retry` — retry a previous task.
- `POST /v1/candidates/{candidate_id}/validate` — validate a candidate and classify CMS importability.

All API endpoints except `/health` require `Authorization: Bearer <token>`.

## Tests

```sh
cd services/scrapling-collector
SCRAPLING_API_TOKEN=test-token python -m unittest discover -s tests -v
```

The GitHub Actions workflow runs Python compilation and the collector security/persistence unit tests on relevant changes.
