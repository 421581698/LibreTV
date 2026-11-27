# CMS → HLS exact media-asset binding gate (PR #99)

## Implemented integration

- Collector operator-authenticated CMS registration accepts an HLS asset **only** when it is the registered immutable graph root for a validated PUBLIC / PLAYER_CONFIRMED DIRECT_MEDIA HLS resource.
- Exact source key, VOD ID, episode index, provider URL SHA-256, and playback URL SHA-256 remain mandatory. Ambiguous, revoked, missing-graph, wrong-root and mismatched-format bindings fail closed.
- Browser API independently verifies the HLS root identity against the collector response. It never infers a binding from the CMS title or ID alone.
- The watch player retains the original CMS HLS URL for native Safari / HLS.js playback. A registry root M3U8 cannot safely be served as a standalone byte proxy without rewriting and authenticating every relative variant, key and media-segment URL.
- The registry resource ID is made available to the existing HLS graph inspection and signed fMP4 HEVC RPU analysis endpoints; existing MP4 byte-proxy behavior stays unchanged.

## Evidence boundary

**Registry identity is not proof of the current player's exact bytes.** The CMS CDN may change the playlist or chosen variant, and Safari does not expose the chosen rendition or whether hardware consumed Dolby Vision RPU. Signed graph-bound offline analysis is a statement about the **registered** immutable rendition, not unverified current playback. No new system decoder, RPU-aware compositor, or Dolby-certified HDR output is claimed.

## Release/acceptance gates

1. Collector Python CMS binding positive and negative tests.
2. API route HLS root/schema tests.
3. Cinema playback gate regression, types, lint, build.
4. Signed registered HLS fMP4 analysis with an **authorized** real asset and independent per-frame HEVC/RPU PTS correspondence. Aggregate frame-count parity is insufficient.
5. Real iPadOS Safari playback with device, OS, asset hash, selected variant and independent output measurements before passing the 3.1–3.6 gates.

Keep PR #99 Draft and do not merge, change main or deploy production without explicit authorization.
