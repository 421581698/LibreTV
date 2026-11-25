# LibreTV Dolby Vision parser service

A private Node.js analysis service for trusted backend-to-backend use. It accepts **MP4 media bytes**, never arbitrary URLs, hashes the original upload, uses FFmpeg to copy-extract the HEVC video track without re-encoding, runs the repository's pinned offline `dovi_tool` adapter, and signs a short-lived report using an Ed25519 private key.

## Security boundary

- Keep this service on a private network. Do not expose it directly to browsers or the public Internet.
- Only the authenticated Node.js backend route `/api/dolby-vision/assets/{assetId}/analyze` may call it, using `DV_SERVICE_TOKEN`; browsers never receive this token.
- The backend route resolves `assetId` through the authenticated collector registry, streams the registered content-addressed MP4 object, checks the registry digest/ETag binding, and sends those exact bytes with the asset ID, original SHA-256 and source MIME headers.
- The service independently hashes the received MP4 upload and rejects any digest mismatch. It also records the extracted HEVC track hash separately; the signed `sourceMediaSha256` remains bound to the original MP4 bytes. The signing primitive independently requires the report digest to equal the exact upload digest supplied by the ingest request; a detached or mismatched report cannot be signed.
- Analysis reports are not cached or reused. Each request re-streams the current immutable content-addressed object and reruns the pinned parser, avoiding stale evidence across asset replacement, parser upgrades, or analysis-parameter changes.
- The signing key is injected at runtime as a secret; never commit it, bake it into the image, or expose it to the player.
- No remote URL fetching is implemented. This avoids SSRF and uncontrolled third-party media retrieval.
- Upload size, concurrent jobs, parser runtime and request time are bounded.

## Local Docker Compose profile

The repository's root `docker-compose.yml` includes opt-in `collector` and `dolby-vision` profiles. The parser does not publish a host port; it runs on a dedicated `internal: true` network shared only with the LibreTV app container, so the parser has no direct outbound Internet route. The collector stores staged media on its persistent volume and the app reaches it through the private collector network.

```sh
mkdir -p secrets
openssl genpkey -algorithm ED25519 -out secrets/dv-signing-private-key.pem
openssl pkey -in secrets/dv-signing-private-key.pem -pubout -out secrets/dv-signing-public-key.pem
openssl rand -hex 32 > secrets/dv-ingestion-token
chmod 400 secrets/dv-signing-private-key.pem secrets/dv-ingestion-token
# The containers run as node (UID 1000) and collector (UID 10001).
# Make the two mounted files readable by their respective service users.
sudo chown 1000:1000 secrets/dv-signing-private-key.pem
sudo chown 10001:10001 secrets/dv-ingestion-token
export PASSWORD="replace-with-your-own-long-password"
export SCRAPLING_API_TOKEN="$(openssl rand -hex 32)"
export DV_INGESTION_TOKEN_FILE="$PWD/secrets/dv-ingestion-token"
export DV_SERVICE_TOKEN="$(openssl rand -hex 32)"
export DV_SIGNING_KEY_ID="dv-key-1"
export DV_SIGNING_PRIVATE_KEY_FILE="$PWD/secrets/dv-signing-private-key.pem"
export DV_SIGNING_PUBLIC_KEY_PEM_B64="$(openssl base64 -A -in secrets/dv-signing-public-key.pem)"
export DV_REGISTRY_API_BASE="http://scrapling-collector:8000"
export DV_PARSER_API_BASE="http://dolby-vision-parser:8788"
docker compose --profile collector --profile dolby-vision up -d --build
docker compose ps libretv scrapling-collector dolby-vision-parser
```

The private key is mounted read-only at `/run/secrets/dv-signing-private-key`; the local `secrets/` directory is ignored by Git. The public key is passed to the backend verifier as base64 PEM through `DV_SIGNING_PUBLIC_KEY_PEM_B64`; it is not secret, but must match the private key. The backend route checks the expected key ID, signature, asset ID, expiry, and exact media digest before returning verified evidence. The health endpoint is available inside the Compose network at `http://dolby-vision-parser:8788/health`.

These profiles start the collector and private parser. The local-file ingestion worker and authenticated Range-capable object-streaming route are available. The registry player switches to the registered immutable MP4/WebM object when available; the diagnostics panel requests RPU analysis only for MP4 assets. The parser rejects non-HEVC MP4 video tracks rather than treating arbitrary MP4 bytes as HEVC. Browser-native Dolby Vision decode and display output remain unverified. Do not configure the browser to call the parser or collector directly.

## Build

```sh
docker build -f services/dolby-vision-parser/Dockerfile -t libretv-dv-parser .
```

## Run

Provide secrets through the deployment secret manager:

- `DV_SERVICE_TOKEN`: long random backend-only bearer token.
- `DV_SIGNING_KEY_ID`: current public-key identifier.
- `DV_SIGNING_PRIVATE_KEY_PEM`: Ed25519 PKCS#8 private PEM.
- `DV_MAX_UPLOAD_BYTES`: optional, defaults to 536870912 (512 MiB); accepted range is 1 KiB–2 GiB.
- `DV_MAX_CONCURRENT_JOBS`: optional, defaults to 1; accepted range is 1–8.
- `DV_ANALYSIS_TIMEOUT_MS`: optional, defaults to 900000 (15 minutes); accepted range is 10 seconds–1 hour.

Run the container behind private ingress only. Store the matching public key in the web backend as base64 PEM in `DV_SIGNING_PUBLIC_KEY_PEM_B64` and configure `DV_SIGNING_KEY_ID` separately. Rotate keys by deploying a new key ID and overlapping verifier support during the rotation window.

## Request contract

`POST /v1/analyze`

Headers:
- `Authorization: Bearer <backend-only-token>`
- `Content-Type: application/octet-stream`
- `Content-Length: <exact byte count>`
- `X-DV-Asset-Id: <immutable catalogue asset ID>`
- `X-DV-Asset-SHA256: <original MP4 SHA-256>`
- `X-DV-Source-Content-Type: video/mp4`

Body: the exact full media object bytes. The gateway, not the browser, is responsible for the trusted asset-ID-to-digest mapping.

Success: a signed version-1 envelope containing asset ID, issue/expiry times, parser report and Ed25519 signature. `report.inputSha256` identifies the extracted HEVC bitstream; `report.sourceMediaSha256` identifies the original MP4 object used by the player. Failure: a generic error code; internal paths, keys and parser stderr are not returned.

## Local tests

```sh
node --test services/dolby-vision-parser/server.test.mjs
```

The backend analysis route is wired to the trusted registry and parser transport, and the player panel invokes it only for immutable MP4 assets. The asset must already have been ingested by the trusted local-file worker; never send client-supplied digests as trusted expectations.
