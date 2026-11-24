# Dolby Vision player diagnostics integration

Updated: 2026-11-24  
Branch: `feature/libretv-ipad-edition-product`  
Status: initial read-only UI integration; acceptance is still in progress.

## Implemented

- Added `src/components/dolby-vision-diagnostics-panel.tsx`, a read-only panel in the existing player overlay.
- Connected it to `src/components/player-shell.tsx`.
- For hls.js playback, the player inspects each parsed level's original `CODECS` and `SUPPLEMENTAL-CODECS` attributes in addition to the normalized `videoCodec` field. This avoids relying on a normalized field that may not preserve supplemental Dolby Vision signaling.
- For direct-file and native-HLS paths, the current integration reports only information actually available from the URL/path and leaves codec/RPU status unknown when no trustworthy declaration is exposed.
- The panel distinguishes declared format/Profile from RPU presence, dynamic metadata, browser decoding and display output.

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
5. The evidence transport trust boundary is now documented in [RPU-EVIDENCE-TRANSPORT.md](./RPU-EVIDENCE-TRANSPORT.md). Runtime integration remains blocked until a controlled parser worker, authenticated report signing, and exact media-byte binding exist. Do not embed parser claims or synthetic fixtures as runtime evidence.

## Release boundary

This is a diagnostic UI only. It does not alter decoding, transcoding, bitstream passthrough, quality selection, source selection, or audio processing. PR #99 remains Draft and is not merged.
