# LibreTV Dolby Vision parser service

A private Node.js analysis service for trusted backend-to-backend use. It accepts **media bytes**, never arbitrary URLs, hashes the received bytes, runs the repository's pinned offline `dovi_tool` adapter, and signs a short-lived report using an Ed25519 private key.

## Security boundary

- Keep this service on a private network. Do not expose it directly to browsers or the public Internet.
- Only the trusted media gateway may call it, using `DV_SERVICE_TOKEN`.
- The gateway must resolve `assetId` to an immutable media object and its SHA-256 in a trusted catalogue, then stream those exact bytes and send the catalogue's ID and digest headers.
- The service independently hashes the received upload and rejects any digest mismatch.
- The signing key is injected at runtime as a secret; never commit it, bake it into the image, or expose it to the player.
- No remote URL fetching is implemented. This avoids SSRF and uncontrolled third-party media retrieval.
- Upload size, concurrent jobs, parser runtime and request time are bounded.

## Build

```sh
docker build -f services/dolby-vision-parser/Dockerfile -t libretv-dv-parser .
```

## Run

Provide secrets through the deployment secret manager:

- `DV_SERVICE_TOKEN`: long random backend-only bearer token.
- `DV_SIGNING_KEY_ID`: current public-key identifier.
- `DV_SIGNING_PRIVATE_KEY_PEM`: Ed25519 PKCS#8 private PEM.
- `DV_MAX_UPLOAD_BYTES`: optional, defaults to 536870912 (512 MiB).
- `DV_MAX_CONCURRENT_JOBS`: optional, defaults to 1.
- `DV_ANALYSIS_TIMEOUT_MS`: optional, defaults to 900000 (15 minutes).

Run the container behind private ingress only. Store the matching public key in the web backend as `DOLBY_VISION_VERIFY_PUBLIC_KEY_PEM` and configure the expected key ID separately. Rotate keys by deploying a new key ID and overlapping verifier support during the rotation window.

## Request contract

`POST /v1/analyze`

Headers:
- `Authorization: Bearer <backend-only-token>`
- `Content-Type: application/octet-stream`
- `Content-Length: <exact byte count>`
- `X-DV-Asset-Id: <immutable catalogue asset ID>`
- `X-DV-Asset-SHA256: <catalogue SHA-256>`

Body: the exact full media object bytes. The gateway, not the browser, is responsible for the trusted asset-ID-to-digest mapping.

Success: a signed version-1 envelope containing asset ID, issue/expiry times, parser report and Ed25519 signature. Failure: a generic error code; internal paths, keys and parser stderr are not returned.

## Local tests

```sh
node --test services/dolby-vision-parser/server.test.mjs
```

This service is not yet wired to LibreTV's player: the current application does not provide the immutable asset catalogue and trusted media gateway required by the request contract. Do not send client-supplied IDs/digests as trusted expectations.
