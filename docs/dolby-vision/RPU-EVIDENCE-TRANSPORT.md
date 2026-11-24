# Dolby Vision RPU evidence transport and trust boundary

Updated: 2026-11-24  
Branch: `feature/libretv-ipad-edition-product`  
Status: offline parser, private parser-service implementation, Ed25519 verifier, immutable asset registry, local-file ingestion worker, and authenticated object streaming endpoint implemented; trusted staging gateway, parser forwarding/deployment, and runtime player binding remain blocked.

## Current verified capabilities

- The offline `scripts/dolby-vision/analyze-rpu.mjs` adapter invokes pinned `dovi_tool 2.3.x` against local HEVC/MKV or pre-extracted RPU bytes.
- The strict Zod report contract validates parser version, report shape, profile/level consistency, distinct-frame counts, extraction scope and SHA-256 syntax.
- HEVC reports can be compared with a separately computed SHA-256 of the exact media bytes. A mismatch is rejected; a missing hash is marked `detached`.
- CI exercises a parser RPU fixture plus pinned HEVC elementary-stream and Matroska fixtures. This verifies the offline adapter, not a production media-analysis service.\n- `services/scrapling-collector/dv_media_ingest.py` hashes trusted staged local files, stores them under content-addressed keys using no-overwrite atomic creation, verifies existing objects before reuse, and registers only after durable storage. It does not fetch URLs.\n- `GET /v1/registry/media-assets/{asset_id}/content` streams only registry-bound objects behind the collector bearer credential. Consumers must hash the received bytes and compare them with the returned digest.

## Security decision: do not import arbitrary report JSON into the player

The report's `verified: true`, `source: dovi_tool`, parser version and hashes are self-reported JSON fields. Zod validation proves structural consistency only; it does not authenticate who ran the parser. A client-provided report can be forged, and a matching hash string supplied inside that report is not proof that the current media bytes were hashed.

Therefore:
- Do not accept report JSON from local storage, query parameters, player events, or an untrusted API response as verified RPU evidence.
- Do not pass a structurally valid but `detached` report to `inspectDolbyVisionMetadata` as trusted evidence.
- Do not label the player as RPU-present or dynamic-metadata-confirmed based on a report until both producer authenticity and exact media-byte binding are established.
- Keep browser decode and display Dolby Vision output as separate, unverified states.

## Implemented parser service and verification primitive

- `services/dolby-vision-parser/` contains a private Node service and Docker image pinned to `dovi_tool 2.3.4`.
- The service accepts raw media bytes only; it does not fetch caller-provided URLs. It requires a backend bearer token, stable asset ID and catalogue SHA-256, verifies the uploaded bytes against that digest, bounds upload size/concurrency/runtime, runs the offline analyzer, and signs the result with an injected Ed25519 private key.
- Service secrets are runtime-only and must be stored in a deployment secret manager. The service must sit behind private ingress, not be exposed directly to browsers.
- The trusted media gateway must resolve the immutable asset ID to the digest and stream those exact bytes. The service cannot independently infer the catalogue relationship from a client-supplied ID.

## Implemented verification primitive

- `src/lib/dolby-vision/signed-rpu-envelope.ts` validates a versioned Ed25519-signed envelope.
- The verifier pins key ID, stable asset ID, issue/expiry time, full-scan scope, strict report schema, and exact media SHA-256.
- Unit tests cover valid signatures, tampering, wrong key ID, wrong asset, digest mismatch, expiry, future issue time, partial scans, and detached RPU input.
- The verifier deliberately requires the expected asset ID and digest as trusted server-side inputs. It must not be called with values copied from the client request or the envelope itself.

## Required production transport

A future implementation must provide all of these properties:

1. **Trusted producer** — the private parser service implementation is present under `services/dolby-vision-parser/`; it still must be deployed behind private ingress with secrets provisioned. The signing key is available only to that service, never shipped to the browser or included in the repository.
2. **Exact asset identity** — the worker hashes the exact media object it analyzes. The player/backend resolves a stable asset identity (not merely a URL string) and compares the report's input digest with the selected asset's digest.
3. **Authenticated report** — the worker signs a canonical, versioned report envelope (for example Ed25519). The app verifies the signature against a pinned public key before parsing the payload.
4. **Scope transparency** — the report carries track, frame limit, parser version and analysis timestamp. Partial scans must remain explicitly partial and cannot be presented as whole-file absence.
5. **Resource limits** — enforce maximum input size, analysis time, concurrent jobs, cache lifetime and request rate. Never let an unauthenticated URL trigger unrestricted server-side fetching; this would introduce SSRF and resource-exhaustion risks.
6. **Fail closed** — missing signature, unknown key/version, digest mismatch, partial/unavailable evidence or parser error maps to `unknown`, not `absent`.
7. **Privacy** — do not upload user-selected local media without an explicit user action and clear disclosure. Prefer a controlled origin-side analysis pipeline for media already hosted by the service.

## Deployment blocker

The repository now contains a local-file ingestion worker that computes SHA-256 from the staged bytes, stores them in a persistent content-addressed volume with no-overwrite semantics, and only then registers the digest. An authenticated read-only registry endpoint streams the exact object by asset ID. However, the trusted gateway that obtains and stages authorized source bytes is not implemented; the local Docker volume is not an external WORM/object-lock store; and no backend forwarder currently streams the object into the private parser and compares the parser's received-byte digest. The parser deployment, key lifecycle, and player evidence endpoint also remain unimplemented. The ingestion worker is a local primitive, not an automatic public-URL fetcher. The generic media proxy is not an evidence producer and must not be repurposed as one.

Until the deployment prerequisites exist, the player correctly displays RPU/dynamic metadata as **unverified**. This is an intentional trust boundary, not an unfinished UI toggle.

## Acceptance gates

- [x] Implement and document a private parser service and backend-only bearer boundary.\n- [ ] Deploy the parser service behind private ingress and provision signing/service secrets with a key rotation process.\n- [ ] Provision the separate DV ingestion secret and connect only the trusted ingestion worker to the registry endpoint.
- [x] Define canonical signed envelope and signature verification tests (valid, tampered, wrong-key, expired/stale, unsupported version).
- [x] Add a content-addressed media-asset registry primitive with a separate ingestion credential and immutable metadata semantics.\n- [x] Implement a local-file ingestion worker that hashes staged bytes and writes a no-overwrite content-addressed object before registry insertion.\n- [x] Add an authenticated read-only object streaming endpoint bound to the registry asset ID.\n- [ ] Deploy a trusted gateway to stage authorized source bytes and provision durable object storage with production immutability/retention controls.\n- [ ] Implement the backend forwarder that streams the registered object into the parser and verifies the parser-received digest.\n- [ ] Establish exact media asset identity and digest binding across source selection and playback.
- [x] Add upload size, concurrent job, parser timeout and backend bearer controls to the parser service.\n- [x] Run parser subprocess asynchronously so the HTTP server can enforce concurrency limits and remain responsive during long analysis jobs.\n- [ ] Configure production ingress rate limits, monitoring, key rotation and operational alerting.
- [x] Add verifier unit tests proving detached, tampered, mismatched and partial reports are rejected.\n- [ ] Add end-to-end integration tests proving rejected reports never become positive player evidence.
- [ ] Only then connect authenticated evidence to the read-only diagnostics panel.
- [ ] Separately test native HLS behavior and actual Dolby Vision output on supported physical iPad hardware.

## Release boundary

No player behavior or playback pipeline is changed by this design document. PR #99 remains Draft and is not merged.
