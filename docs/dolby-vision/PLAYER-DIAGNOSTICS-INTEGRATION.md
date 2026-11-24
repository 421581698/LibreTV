# Dolby Vision player diagnostics integration

Updated: 2026-11-24  
Branch: `feature/libretv-ipad-edition-product`  
Status: read-only UI, opt-in signed-evidence analysis action, server-side transport, and strict client response-shape guard are implemented; selected-playback-to-asset mapping remains blocked.

## Implemented

- Added `src/components/dolby-vision-diagnostics-panel.tsx`, a read-only panel in the existing player overlay.
- Connected it to `src/components/player-shell.tsx`.
- For hls.js playback, the player inspects each parsed level's original `CODECS` and `SUPPLEMENTAL-CODECS` attributes in addition to the normalized `videoCodec` field. This avoids relying on a normalized field that may not preserve supplemental Dolby Vision signaling.
- For direct-file and native-HLS paths, the current integration reports only information actually available from the URL/path and leaves codec/RPU status unknown when no trustworthy declaration is exposed.
- The panel distinguishes declared format/Profile from RPU presence, dynamic metadata, browser decoding and display output.
- Added `POST /api/dolby-vision/assets/{assetId}/analyze`: it reads the registered object through the authenticated collector endpoint, streams it to the private parser, and verifies the signed envelope against the registry-provided digest before returning evidence. Server-only tokens and the pinned public key are never sent to the browser.\n- The diagnostics panel now offers an explicit analysis action only when `PlayerShell` receives a stable `dolbyVisionAssetId`. It aborts stale requests when the asset identity changes, rejects malformed/mismatched responses, and displays only the verified RPU report. It keeps browser decoding and display output marked unverified.\n- Added a strict response-shape parser and tests for matching asset ID, signature-binding status, parser version, frame count, and expiry ordering. The client parser is a display guard only; cryptographic verification remains server-side.

## Deliberate non-claims

- A `dvh1`/`dvhe`/`dav1` declaration is not proof that the media payload contains a valid RPU.
- A parsed RPU does not prove that the current browser/device decodes Dolby Vision.
- Browser codec capability probes do not prove that the active display path is outputting Dolby Vision.
- HLS level metadata describes available variants, not necessarily the currently selected and decoded variant.
- Safari native HLS does not expose the same parsed playlist attributes as hls.js through this integration; unavailable evidence remains unknown.

## Next acceptance work

1. Add component/integration tests for hls.js levels containing regular and supplemental Dolby Vision declarations.
2. Run TypeScript, ESLint, unit tests, production build and browser playback smoke tests on the latest branch head.
3. Execute the physical-device acceptance matrix in [IPADOS-DEVICE-ACCEPTANCE.md](./IPADOS-DEVICE-ACCEPTANCE.md); desktop WebKit automation is not a substitute.
4. Add controlled, licensed HEVC samples for full-stream RPU analysis and compare the analyzer output with the corresponding manifest declarations.
5. Pass the actual registry-issued `assetId` from the selected resource record into `PlayerShell` as `dolbyVisionAssetId`. Do not derive it from a URL, episode key, or `resourceKey`. Until that source mapping exists, the panel correctly explains that RPU analysis is unavailable.\n6. The evidence transport trust boundary and server-side forwarding route are documented in [RPU-EVIDENCE-TRANSPORT.md](./RPU-EVIDENCE-TRANSPORT.md). The player panel must not call the route until the selected playback episode can be mapped to a registered `assetId` whose bytes are the exact media being played. The current `sourceKey` / `resourceKey` episode labels are not registry asset IDs and must not be substituted. The trusted source-staging gateway and this stable mapping are still missing. Do not embed parser claims or synthetic fixtures as runtime evidence.

## Release boundary

This is a diagnostic UI only. It does not alter decoding, transcoding, bitstream passthrough, quality selection, source selection, or audio processing. PR #99 remains Draft and is not merged.
