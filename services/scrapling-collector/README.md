# LibreTV FMHY / Scrapling Collector

This is a separate Python service because Scrapling is a Python crawler, not a Cloudflare Worker module.

## Pipeline

1. Discover candidate sites only from the FMHY Movies / TV / Anime directory: https://fmhy.net/video
2. Fetch a selected discovered page with Scrapling's HTTP Fetcher.
3. Return publicly linked media or player URLs as candidates. LibreTV must validate each candidate against its own source rules before importing it.

The service deliberately does not log in, bypass paywalls/DRM, defeat access controls, or crawl hosts that were not discovered from FMHY. It blocks non-public IP targets and accepts HTTPS only.

## Run

```sh
export SCRAPLING_API_TOKEN="$(openssl rand -hex 32)"
docker compose up -d --build scrapling-collector
```

The API is internal to the Docker Compose network on port 8000. Configure the LibreTV server with:

- `SCRAPLING_API_BASE=http://scrapling-collector:8000`
- `SCRAPLING_API_TOKEN=<same token>`

For Cloudflare-hosted LibreTV, deploy this container on a separately reachable private service and set the two values as Worker secrets/vars. Do not expose the collector without a strong token.

## Endpoints

- `GET /health`
- `GET /v1/discover` — FMHY directory entries
- `POST /v1/crawl` — one selected FMHY-discovered page

Every API endpoint except health requires `Authorization: Bearer <token>`.
