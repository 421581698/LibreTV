# Dolby Vision RPU evidence transport and trust boundary

Updated: 2026-11-24  
Branch: `feature/libretv-ipad-edition-product`  
Status: offline parser, private parser service with MP4-to-HEVC demux, Ed25519 verifier, immutable asset registry, opt-in allowlisted MP4/WebM and clear-HLS source gateways, durable asynchronous ingestion jobs, Range streaming, and registry-backed immutable playback implemented; production object-lock storage, live authorized-origin validation, and physical-device output validation remain pending.

## Current verified capabilities

- The offline `scripts/dolby-vision/analyze-rpu.mjs` adapter invokes pinned `dovi_tool 2.3.x` against local HEVC/MKV or pre-extracted RPU bytes.
- The strict Zod report contract validates parser version, report shape, profile/level consistency, distinct-frame counts, extraction scope and SHA-256 syntax.
- Reports distinguish `inputSha256` (the HEVC bitstream actually parsed) from `sourceMediaSha256` (the original MP4 asset played by the browser). The signed `sourceMediaSha256` must match the registry digest; a mismatch is rejected and an absent binding remains `detached`.
- CI exercises a parser RPU fixture plus pinned HEVC elementary-stream and Matroska fixtures, asserting the full 259-frame RPU scan and exact input digest. It also remuxes the pinned real HEVC fixture into MP4 and runs the private parser HTTP service with real FFmpeg/ffprobe/dovi_tool subprocesses; the test verifies full-frame extraction, original MP4 digest binding, extracted HEVC digest, and Ed25519 signature. This is a real encoded integration fixture, not a feature-length commercial asset or a live production deployment.
- `services/scrapling-collector/dv_media_ingest.py` hashes trusted staged local files, stores them under content-addressed keys using no-overwrite atomic creation, verifies existing objects before reuse, and registers only after durable storage. It does not fetch URLs.
- `POST /v1/registry/resources/{resource_id}/media-assets/ingest` accepts bounded MP4/WebM bytes behind a dedicated ingestion token, stages them privately, then invokes the same hashing/storage worker. It accepts no URLs and never fetches remote resources.
- `GET /v1/registry/media-assets/{asset_id}/content` streams only registry-bound MP4/WebM objects behind the collector bearer credential and supports a single byte range for native playback and seeking. Consumers must hash the received bytes and compare them with the returned digest.
- `POST /api/dolby-vision/assets/{assetId}/analyze` uses server-only collector/parser credentials, streams the exact registered MP4 object into the parser, and verifies the Ed25519 envelope against the registry-provided asset ID and original media digest before returning positive evidence.

## Security decision: do not import arbitrary report JSON into the player

The report's `verified: true`, `source: dovi_tool`, parser version and hashes are self-reported JSON fields. Zod validation proves structural consistency only; it does not authenticate who ran the parser. A client-provided report can be forged, and a matching hash string supplied inside that report is not proof that the current media bytes were hashed.

Therefore:
- Do not accept report JSON from local storage, query parameters, player events, or an untrusted API response as verified RPU evidence.
- Do not pass a structurally valid but `detached` report to `inspectDolbyVisionMetadata` as trusted evidence.
- Do not label the player as RPU-present or dynamic-metadata-confirmed based on a report until both producer authenticity and exact media-byte binding are established.
- Keep browser decode and display Dolby Vision output as separate, unverified states.

## Implemented parser service and verification primitive

- `services/dolby-vision-parser/` contains a private Node service and Docker image pinned to `dovi_tool 2.3.4`.
- The service accepts raw media bytes only; it does not fetch caller-provided URLs. For MP4 it enumerates every video stream and requires exactly one HEVC video track; multi-video-track containers are rejected rather than silently analyzing only `v:0`. It uses FFmpeg stream-copy plus `hevc_mp4toannexb` to extract that bitstream without re-encoding, hashes the parser input separately, and signs both the HEVC input hash and original MP4 source hash. It requires a backend bearer token, stable asset ID and catalogue SHA-256, and bounds upload size/concurrency/runtime.
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
5. **Resource limits** — enforce maximum input size, analysis time, concurrent jobs and request rate. Report caching is currently disabled. If caching is introduced later, its key must include the immutable asset ID, original media SHA-256, parser and `dovi_tool` versions, and every analysis parameter; each cache hit must still re-check the current registry digest and evidence expiry. Never let an unauthenticated URL trigger unrestricted server-side fetching; this would introduce SSRF and resource-exhaustion risks.
6. **Fail closed** — missing signature, unknown key/version, digest mismatch, partial/unavailable evidence or parser error maps to `unknown`, not `absent`.
7. **Privacy** — do not upload user-selected local media without an explicit user action and clear disclosure. Prefer a controlled origin-side analysis pipeline for media already hosted by the service.

## Immutable HLS graph

- `services/scrapling-collector/dv_hls_ingest.py` now ingests a trusted local clear-HLS staging directory recursively. It creates content-addressed objects for the root/master playlists, nested playlists, initialization sections, media segments, audio and subtitles, and records parent-child edges in `registry_hls_asset_edges`.
- Playlist URI references are rewritten to immutable same-origin asset content routes. The Next.js asset lookup can select an HLS root playlist, while the content proxy accepts the bounded HLS member MIME allowlist and preserves byte-range responses.
- `services/scrapling-collector/dv_hls_source_gateway.py` fetches the complete authorized graph into private staging after playback confirmation. Every root/child hostname must be explicitly allowlisted and pinned to a validated public IP; redirects, path traversal, live playlists, malformed URI attributes, cyclic references, unsupported member types, and encryption/DRM key tags are rejected.
- The durable worker verifies staged media-member digests against transfer digests before immutable graph registration, checkpoints large transfers, and cleans staging on success, failure, or cancellation. HLS source acquisition is opt-in and does not fetch arbitrary client URLs.
- The registry player can use an immutable HLS root playlist when one has been staged and registered. HLS codec declarations remain declaration-only: HLS RPU parsing and signed whole-program/segment evidence are not claimed by this graph implementation.

## Deployment blocker

The repository now contains the offline analyzer, private parser service, Ed25519 signing/verifier primitives, immutable asset registry, local-file ingestion worker, authenticated raw-byte ingress, allowlisted progressive-media and HLS graph source gateways, durable asynchronous ingestion jobs, object streaming endpoint, and server-side parser forwarder. Source gateways require explicit operator enablement, exact authorized-host allowlists, public-IP pinning, bounded bytes/time, and persisted preflight plus playback confirmation. The ingestion path computes SHA-256 from received bytes, stores content-addressed objects, verifies storage before registration, and applies configurable upload/concurrency limits.

The remaining blockers are operational and end-to-end:
- The source gateways are implemented but disabled by default. Operators must configure exact authorized hostnames, verify the egress firewall, and test against sources they have explicit rights to retrieve and store. No generic URL-fetching proxy is permitted.
- The current local Docker volume is not an external WORM/object-lock store with production retention and durability guarantees.
- The parser service, signing key lifecycle, collector secret, and backend public-key configuration must be provisioned and deployed behind private network boundaries.
- The server-side forwarder and MP4 demux transport have automated tests but have not yet been validated against the live Compose services.
- The durable worker now populates the registry from authorized MP4/WebM sources and clear-HLS graphs after playback confirmation. The player resolves matching immutable assets and passes an asset ID to RPU diagnostics only for MP4; live Compose and authorized-origin integration are still pending.
- Actual Dolby Vision decoding and display output still require validation on supported physical iPad hardware.

Until these prerequisites are met, the player correctly displays RPU/dynamic metadata as **unverified**. This is an intentional trust boundary, not an unfinished UI toggle.

## Acceptance gates

- [x] Implement and document a private parser service and backend-only bearer boundary.
- [ ] Deploy the parser service behind private ingress and provision signing/service secrets with a key rotation process.
- [x] Add a separate DV ingestion secret and authenticated raw-byte ingress endpoint.
- [ ] Provision the dedicated ingress secret only for deployments that use the separate authenticated raw-byte ingress client; the in-process authorized source gateways use the collector's local registry worker path.
- [x] Define canonical signed envelope and signature verification tests (valid, tampered, wrong-key, expired/stale, unsupported version).
- [x] Add a content-addressed media-asset registry primitive with a separate ingestion credential and immutable metadata semantics.
- [x] Add an immutable HLS asset graph with explicit root identity, parent/child edges, local playlist/segment ingestion, URI rewriting, and shared byte-range proxy delivery.
- [x] Add opt-in, allowlisted MP4/WebM and clear-HLS source gateways with durable job queueing, public-IP pinning, strict byte/time bounds, redirect rejection, transfer-digest checks, and cancellation cleanup.
- [ ] Validate an ingested immutable HLS graph end-to-end in live HLS.js and native Safari playback against real media sources.
- [x] Implement a local-file ingestion worker that hashes staged bytes and writes a no-overwrite content-addressed object before registry insertion.
- [x] Add an authenticated raw-byte ingestion endpoint using a dedicated token, exact content length, and no URL fetching.
- [x] Add an authenticated read-only object streaming endpoint bound to the registry asset ID.
- [x] Implement an opt-in trusted source gateway for authorized progressive media and clear-HLS graphs; require operator-managed exact-host allowlists and verified egress firewall.
- [ ] Configure real authorized source hosts, validate against those origins, and provision durable object storage with production immutability/retention controls.
- [x] Implement the server-side backend forwarder that streams the registered object into the parser and verifies the signed response against the registry-bound asset ID and digest.
- [ ] Deploy and end-to-end validate the forwarder against the live private Compose services.
- [x] Bind the selected registry asset ID through immutable MP4 playback and signed RPU evidence; distinguish original MP4 SHA-256 from extracted HEVC input SHA-256.
- [x] Add upload size, concurrent job, parser timeout and backend bearer controls to the parser service.
- [x] Run parser subprocess asynchronously so the HTTP server can enforce concurrency limits and remain responsive during long analysis jobs.
- [ ] Configure production ingress rate limits, monitoring, key rotation and operational alerting.
- [x] Add verifier unit tests proving detached, tampered, mismatched and partial reports are rejected.
- [x] Add route tests proving digest/asset mismatches and unbound registry responses fail closed before returning positive evidence.
- [ ] Add full live-service integration tests proving rejected reports never become positive player evidence.
- [x] Add an explicit, opt-in diagnostics-panel action that requests server-verified evidence only when a stable server-issued asset ID is supplied.
- [x] Propagate the selected source's trusted registry asset ID through `RegistryInlinePlayer` into `PlayerShell`; only the immutable MP4 URL receives the RPU analysis asset ID.
- [x] Connect authenticated, signed RPU evidence to the read-only diagnostics panel for immutable MP4-backed registry sources.
- [ ] Separately test native HLS behavior and actual Dolby Vision output on supported physical iPad hardware.

## Release boundary

Registry playback now prefers immutable MP4/WebM assets and explicit immutable HLS graph roots when available, retaining the original source as a fallback. RPU analysis remains enabled only for MP4 assets with an HEVC video track; HLS RPU analysis is not claimed. PR #99 remains Draft and is not merged.
