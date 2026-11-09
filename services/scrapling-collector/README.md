# LibreTV FMHY / Scrapling Collector

Scrapling is a Python crawling framework, so the collector runs as an isolated Python service. LibreTV calls it through the authenticated Next.js API proxy; the browser never receives the collector token.

## End-to-end pipeline

1. **Discover** — the only site directory is FMHY Movies / TV / Anime: https://fmhy.net/video. Discovered hosts are stored in SQLite.
2. **Fetch** — Scrapling Spider crawls the selected FMHY-discovered host with a bounded same-host page budget, per-domain delay, robots.txt compliance, and a persistent crawl checkpoint.
3. **Adapt** — Scrapling adaptive selectors save element traits by domain and try to relocate matching elements after page markup changes.
4. **Render / capture** — when HTTP collection finds no candidates, or browser mode is explicitly selected, StealthySession renders JavaScript and records public text-based network responses. JSON responses with a CMS-like `list` shape are surfaced as CMS API candidates.
5. **Classify** — public HTTPS candidates are separated into direct media, embedded player, and CMS API candidates.
6. **Validate** — candidates are DNS/public-IP checked. CMS API candidates are fetched and must return JSON with a list-shaped payload before they can be imported.
7. **Inspect manifests** — bounded HLS parsing extracts variants, codecs, and durations, then follows master-to-variant playlists with a strict depth/request budget and samples only a few media segments; DASH parsing extracts Representation quality, inherited BaseURL paths, SegmentTemplate media/initialization patterns, and SegmentList URLs. All discovered manifest references are resolved and checked for public HTTPS destinations. Template patterns are validated as URL patterns, not expanded into a complete segment timeline or fetched as media.
8. **Import / play** — validated CMS API endpoints can be added to LibreTV's existing custom VOD source store. Direct media candidates are previewed through the existing PlayerShell; they are not misrepresented as CMS sources.
9. **Track / recover** — SQLite stores discovery entries, tasks, candidates, validation results, and task status. Interrupted tasks are marked on service restart and can be retried from Settings → Resource Collection Center.

The collector accepts only HTTPS targets on standard port 443 and checks DNS results for public IP addresses before crawling. Browser capture also installs a per-request guard that rejects non-HTTPS, non-standard-port, unresolved, private, and reserved targets, including redirects and subresource requests. These application checks are defense in depth, not a complete network boundary: DNS can change between validation and connection (TOCTOU). The Docker Compose setup assigns the collector a dedicated static address and disables IPv6 inside the collector. Apply the host firewall rules before exposing the service: after `docker compose --profile collector up -d --build`, run `sudo bash scripts/scrapling-egress-firewall.sh` on the Docker host. This installs an idempotent IPv4 `DOCKER-USER` rule for the collector address, blocking loopback, RFC1918, carrier-grade NAT, link-local (including cloud metadata), documentation, benchmarking, multicast, and reserved ranges while permitting established replies and public IPv4 destinations. If `SCRAPLING_NETWORK_SUBNET` is changed, also set `SCRAPLING_COLLECTOR_IP` to an address inside it and pass that exact address as `COLLECTOR_CIDR`, for example `SCRAPLING_NETWORK_SUBNET=172.31.60.0/24 SCRAPLING_COLLECTOR_IP=172.31.60.10` in the Compose environment and `sudo COLLECTOR_CIDR=172.31.60.10/32 bash scripts/scrapling-egress-firewall.sh`. The firewall blocks both forwarded private/reserved destinations and direct access to host-local services. The firewall script requires Docker's `DOCKER-USER` chain and host `iptables`; environments using nftables or another firewall must implement equivalent forwarding rules. Application checks and host firewall rules are defense in depth; verify the effective host rules and test blocked destinations on the actual deployment host. Do not expose the collector directly to the public internet without HTTPS and a strong token. The collector does not log in, bypass paywalls, DRM, CAPTCHA or access controls. It does not automatically import unvalidated links. A URL being public or returning media bytes does not prove that the content is licensed or suitable for redistribution; operators must ensure they have permission to access and use each source.

## Run locally with Docker Compose

Create a strong token and add it to the LibreTV deployment's environment:

```sh
export SCRAPLING_API_TOKEN="$(openssl rand -hex 32)"
export SCRAPLING_API_BASE="http://scrapling-collector:8000"
docker compose --profile collector up -d --build
sudo bash scripts/scrapling-egress-firewall.sh
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
