# VPS deployment (Cloudflare Worker → Scrapling Collector)

This guide exposes only the authenticated collector API over HTTPS. It does not expose the collector's port 8000 directly. Use a VPS you administer, a DNS name you control, and a strong unique token. Keep the collector isolated from production until the Preview test passes.

## Requirements

- A Linux VPS you administer (Ubuntu 22.04/24.04 or compatible), Docker Engine with the Compose plugin, systemd, and iptables.
- A public DNS **A** record such as `scrapling.example.com` pointing to the VPS IPv4 address.
- TCP ports 80 and 443 reachable from the internet. Do not add an AAAA record unless your host's IPv6 firewall is separately reviewed.
- The repository checked out on branch `feat/pr60-standalone-preview-2026-11-10`.

The included egress script requires Docker's `DOCKER-USER` chain. Do not set `SCRAPLING_EGRESS_FIREWALL_CONFIRMED=1` on a host where the rules cannot be installed and independently verified.

## 1. Prepare secrets and hostname

From the repository root, create a private `.env` file. Do not commit it or paste the token into chat:

```sh
umask 077
cat > .env <<'EOF'
# Compose validates the main LibreTV service even though this guide starts only the collector.
PASSWORD=replace-with-a-long-random-unused-value
SCRAPLING_API_TOKEN=replace-with-a-unique-64-character-hex-token
SCRAPLING_PUBLIC_HOST=scrapling.example.com
SCRAPLING_EGRESS_FIREWALL_CONFIRMED=0
EOF
chmod 600 .env
```

Generate values locally with `openssl rand -hex 32`. Replace the example hostname with the DNS name that points to this VPS. Keep the token stable across restarts; rotate it deliberately and update the Preview Worker secret at the same time.

## 2. Build and start with crawling disabled

```sh
docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile collector config --quiet
docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile collector up -d --build scrapling-collector caddy
docker compose -f docker-compose.yml -f docker-compose.vps.yml ps
```

At this point the service should report healthy, but `crawl_ready` must be `false`. The collector is not yet permitted to fetch external targets.

## 3. Install and persist the host egress boundary

Run these commands from the repository root after the Compose network and collector container exist:

```sh
sudo bash scripts/scrapling-egress-firewall.sh
sudo bash scripts/install-scrapling-egress-firewall-service.sh
sudo iptables -S DOCKER-USER
sudo iptables -S INPUT
```

Confirm that `DOCKER-USER` contains the collector-source jump to `LIBRETV-SCRAPLING-EGRESS`, that the chain drops loopback/private/link-local/reserved destinations before allowing other public IPv4 destinations, and that `INPUT` drops packets sourced from the collector container IP. The installer creates a systemd unit tied to Docker startup so the rules are re-applied after Docker restarts. Review the generated unit and your host firewall policy; do not rely on the installer output alone.

The default collector address is `172.30.60.10/32`. If you changed `SCRAPLING_NETWORK_SUBNET` or `SCRAPLING_COLLECTOR_IP`, pass the exact address to **both** firewall commands, for example:

```sh
sudo env COLLECTOR_CIDR=172.31.60.10/32 bash scripts/scrapling-egress-firewall.sh
sudo env COLLECTOR_CIDR=172.31.60.10/32 bash scripts/install-scrapling-egress-firewall-service.sh
```

Do not proceed if Docker does not use the expected bridge/network, IPv6 is not disabled inside the collector, or the host uses nftables/another firewall without an independently tested equivalent rule set.

## 4. Enable crawling only after firewall verification

Edit `.env` and change:

```env
SCRAPLING_EGRESS_FIREWALL_CONFIRMED=1
```

Then recreate only the collector:

```sh
docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile collector up -d --force-recreate scrapling-collector
docker compose -f docker-compose.yml -f docker-compose.vps.yml logs --tail=100 scrapling-collector caddy
```

This flag is an operator attestation; it does not test the firewall. If the firewall rules are removed or become ineffective, set it back to `0` immediately and stop the collector.

## 5. Verify HTTPS, authentication, and readiness

```sh
set -a
. ./.env
set +a
curl --fail "https://${SCRAPLING_PUBLIC_HOST}/health"
curl -i "https://${SCRAPLING_PUBLIC_HOST}/v1/discover"
curl --fail -H "Authorization: Bearer ${SCRAPLING_API_TOKEN}" "https://${SCRAPLING_PUBLIC_HOST}/v1/discover"
```

Expected:
- `/health`: HTTP 200, `ok: true`, and `crawl_ready: true`.
- Unauthenticated `/v1/discover`: HTTP 401.
- Authenticated `/v1/discover`: a real FMHY directory response. A 502 means the VPS cannot retrieve the directory; inspect collector logs and outbound DNS/network.
- A restart of the collector must preserve task/candidate data in the `scrapling_data` volume.

Do not run broad crawls as a smoke test. First use only a source you own or are expressly authorized to inspect, with a small page limit. The collector is bounded and fail-closed, but a public URL is not proof of copyright permission.

## 6. Connect only the PR #60 Preview Worker

In the Cloudflare dashboard, open the **PR #60 Preview Worker** settings (not production) and set:

- Variable `SCRAPLING_API_BASE`: `https://scrapling.example.com` (no trailing slash).
- Secret `SCRAPLING_API_TOKEN`: the same token from the VPS `.env`.

Save and redeploy the Preview Worker if Cloudflare requires it. Then use Settings → Resource Collection Center to test the connection and refresh the directory. The browser should call the LibreTV Preview API; it must never receive the collector bearer token.

Do not set these values on the production Worker. Do not expose port 8000 directly, commit `.env`, or share the token in screenshots/logs.

## Troubleshooting

- `/health` works but `crawl_ready=false`: keep crawling disabled; verify the firewall service and only then set the operator attestation.
- Caddy cannot obtain a certificate: check DNS A record, ports 80/443, and system clock.
- `/v1/discover` returns 401: token is missing or does not match.
- `/v1/discover` returns 502: inspect `docker compose ... logs scrapling-collector`; verify outbound DNS/HTTPS.
- LibreTV Preview reports connection failure: verify the Preview Worker URL/secret, HTTPS certificate, and that the token matches exactly.
- Never resolve access errors by bypassing login, paywalls, CAPTCHA, DRM, or other access controls.
