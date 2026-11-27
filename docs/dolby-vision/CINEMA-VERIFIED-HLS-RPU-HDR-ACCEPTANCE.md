# Cinema V5.1 Pro: trusted playback bytes, RPU Level 1 and extended HDR evidence

**PR #99, isolated feature branch; NOT product freeze.**

## P0 — Real HLS byte identity

The new `/api/dolby-vision/resources/[resourceId]/verified-hls/[rootAssetId]/[assetId]` route:
- Uses server-only authenticated Collector configuration, not browser-provided credentials.
- Requires the exact registered root and a complete reachable member graph.
- Reads registered SHA-256-verified content objects, checks returned ID, type, length, ETag, digest, and authenticated byte-range shape; for manifests, recomputes SHA-256 on the full source manifest before rewriting.
- Rewrites all supported master, VOD variant, initialization and media-segment URIs to the local asset gateway, with **no arbitrary origin fetch**.
- Rejects live playlists, partial/byterange HLS, missing members, encryption, external URL references, subtitle groups, and uncertain source graph topology.
- Preserves existing MP4 and native CMS URL paths by default. Controlled clear-VOD opt-in: `NEXT_PUBLIC_CINEMA_VERIFIED_HLS_GATEWAY=1` at build time. Enable only after testing a registered compatible graph and confirming the protected registry is available.

**What this proves:** when the gateway is selected and playback succeeds, delivered media bytes are the verified registry objects rather than mutable third-party CDN bytes. A root graph alone (without switching to this route) proves only the registry contents. Network/player instrumentation must confirm the route was actually selected. A browser may still choose among valid registered variants; do not bind variant-specific RPU from a different selection.

## P0 — Per-frame RPU handling

The server dovi_tool 2.3.x path already checks actual RPU NAL digest multiset and presentation timestamps from independently demuxed HEVC samples. It now additionally exports **complete Level 1 per-RPU-frame PQ brightness** only where every frame has usable min/avg/max values, all in range. Server conversion joins these exported values to the decoder presentation-PTS map by exact RPU NAL SHA, not by RPU extraction order. Conflicting or missing values fail closed.

This adds optional `rpuL1Evidence` to the Ed25519-signed report, restricted to **single-layer Dolby Vision Profile 8 HEVC** with a verified complete frame map. The signed HLS analysis API surfaces `registeredRpuL1` only after server signature verification. The client-side `cinemaBuildVerifiedRpuL1Job` additionally validates source/PTS/frame-order/digest identity against independently authenticated raw P010 decoder samples before the existing Cinema frame bridge will process them.

`cinemaTransformRpuL1Pixel` provides **LibreTV's independently implemented scene-adaptive Level 1 tone-map**. This is a real dynamic pixel computation in 10-bit P010, not a static CSS filter and **not** the full Dolby Vision reference display-management or proprietary trim/compositor implementation. Level 1 luminance statistics alone cannot reconstruct Profile 5 IPT, enhancement layers, proprietary MMR/NLQ, L2/L8 trims, or the complete Dolby rendering algorithm.

**Critical integration limit:** ordinary Safari native `<video>` HLS does not give JavaScript access to authenticated decoded 10-bit P010 frames or selected-variant RPU. This custom pixel renderer is usable only when a separately authorized, DRM-free HLS/MP4 demux + raw P010 WebCodecs provider is available. That full end-to-end decoder integration is **NOT established** for ordinary CMS playback.

## P1 — HDR output evidence tiers

`assessCinemaHdrPixelOutput` distinguishes:
1. Authentic P010 samples and 10-bit alignment;
2. Measured changes to actual P010 sample values;
3. Exact-PTS extended WebGPU `rgba16float` / `display-p3` submission, when actually supported and submitted by the runtime;
4. **Physical HDR luminance/EOTF output: unverified**.

The WebGPU presenter now exposes PTS and submission-count receipts after actual queue submission. These are implementation telemetry, **not** display measurement.

## Tests and freeze rule

Unit/integration regressions cover signed source and frame identity, wrong PTS, corrupt L1, mismatched graph members, encrypted HLS rejection, playlist SHA, range integrity, P010 pixel change, and GPU submission receipts. They are software tests, not licensed real-film playback or physical-device HDR proof.

Required before closing 3.1–3.6: a licensed full-length immutable source, exact registered HLS graph and independently identified selected variant; real decoder and every-frame signed RPU mapping; independent sample PTS clock; actual iPadOS Safari play/pause/seek/rotation/variant switching; a reference HDR playback path and calibrated physical brightness/EOTF measurement or trusted display telemetry. If iPadOS exposes no authoritative final display signal, **leave HDR output UNKNOWN**.

Do not merge PR #99, modify `main`, deploy production, imply Dolby certification, or declare full end-to-end Dolby Vision complete based on CI alone.
