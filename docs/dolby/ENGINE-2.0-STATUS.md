# LibreTV Immersive Audio Engine 2.0 — implementation status

Updated: 2026-11-24  
Branch: `feature/libretv-ipad-edition-product` (PR #99, Draft)  
Status snapshot head: `f6f0309c4129b44ffd54473740824b5be5484f7a`

## P1–P6 acceptance summary

| Phase | Implementation status | Acceptance status | Remaining evidence |
|---|---|---|---|
| P1 format detection | Metadata/parser foundations exist | Not finally accepted | Controlled real elementary-stream samples cross-checked against matching HLS manifests |
| P2 spatial presentation | Standalone Web Audio presentation foundation exists | Not finally accepted | Real multichannel HLS/MSE, Safari AudioContext, suspend/resume and failure recovery |
| P3 player integration | Initial isolated session controller and opt-in PlayerShell control implemented for direct MP4/WebM; source-generation guard and native fallback wired | Partially automated; not accepted | Independent hls.js/MSE session, real audio-track selection in the spatial session, Safari/native-HLS device evidence, full lifecycle matrix, exact-head Preview and real-device regression |
| P4 physical devices | Not implemented/recorded | Not accepted | Named iPhone/iPad and output-chain test records |
| P5 diagnostics | Read-only diagnostics HUD foundation exists | Not finally accepted | Correlation with observed output on real device chains |
| P6 release gates | Exact-head software CI passed on `f6f0309c4129b44ffd54473740824b5be5484f7a` | Not accepted | Ubuntu Preview run `45373944056` pending; visual audit and Safari/iOS device regression remain open |

## Landed foundations

- Read-only format detection for AC-3, E-AC-3, TrueHD, DTS, AAC and other existing codecs.
- Dolby AC-4 FourCC detection in HLS `CODECS` metadata, including the four-part codec string:
  `ac-4.<bitstream_version>.<presentation_version>.<mdcompat>`.
- AC-4 `mdcompat` is retained as bounded numeric source metadata and shown as a declared compatibility tier. It is **not** a browser/device decode result and must not enable an Atmos badge.
- HLS audio rendition inspection recognizes `ac-4` alongside the existing codecs.
- Read-only diagnostics continue to report native Dolby decode and bitstream passthrough as unknown, and Atmos object decode as not-established.
- A CORS-guarded Web Audio spatial presentation module is present. It supports opt-in stereo headphone virtualization and a gated 5.1-to-binaural route only when an explicit 5.1 speaker layout is supplied. This is not Dolby Atmos decoding or object rendering.
- P3 initial code: `SpatialMediaSession` owns a distinct media element for direct MP4/WebM only, checks CORS readability before allocation, sets `crossOrigin` before `src`, creates/resumes the Web Audio engine only from the second explicit user gesture, mirrors native play/pause/seek/rate/volume state, and restores the untouched ArtPlayer element on disable/error/source change/unmount. Pending preparation is invalidated on source changes.
- When the direct-media audio channel layout is unknown, the engine deliberately remains on an unprocessed bypass route. This session lifecycle milestone does not yet enable spatial virtualization for those sources.
- HLS is explicitly rejected by the new session controller. hls.js and Safari native HLS continue through their existing routes; no spatial-session HLS track switching is implemented.

## Three core capabilities

- **Dolby Atmos bitstream decoding:** not implemented; no verifiable E-AC-3 JOC, AC-4 or TrueHD browser decoder is included.
- **Atmos object-audio rendering:** not implemented; no Atmos object metadata parser or dynamic object renderer is integrated.
- **Dolby bitstream passthrough:** not implemented or verified; no AVR/Soundbar Atmos passthrough evidence exists.

## P3 architecture and test specification

The following documents define the architecture and test specification. The initial direct-media session implementation now exists, but these documents are not themselves implementation evidence:

- [P3 Architecture Decision Record](./P3-ARCHITECTURE-DECISION.md) — independent Spatial Media Session, CORS/user-gesture gates, session lifecycle and untouched native fallback.
- [P3 Lifecycle Test Matrix](./P3-LIFECYCLE-TEST-MATRIX.md) — episode/provider/track transitions, pause/resume, errors, teardown, fallback and Safari native-HLS regression.

Key safety decision: Web Audio is attached only to the separately-owned direct-media element, never to reusable `art.video`. The existing native element remains the fallback route. Current implementation is limited to MP4/WebM and bypasses processing when channel layout is unknown. HLS/MSE session ownership, spatial audio-track switching and real Safari/iOS acceptance remain incomplete.

## Integration safety gates

1. Keep browser-native playback as the default route.
2. Never attach Web Audio to a cross-origin media element unless its CORS mode and response are known safe. A failed CORS check must leave native playback untouched.
3. Respect the `MediaElementAudioSourceNode` one-element lifecycle. Disconnecting the graph does not restore native playback on a captured element. Do not capture the existing reusable `art.video`.
4. Do not infer a 5.1 speaker order from `CHANNELS=6` or `6/JOC`. Unknown layouts bypass spatial routing.
5. AudioContext activation must happen in an explicit user gesture.
6. Keep codec signalling, actual decode, object rendering, output routing and physical-device acceptance as separate states.
7. Preserve ArtPlayer, hls.js, direct MP4/WebM and Safari native-HLS behavior by default.

## Verified software gates and remaining acceptance

- Chromium HLS playback and standalone Web Audio graph smoke passed on commit `aeb2c7b9a54900698dd5cfb2ebb4e044927f0fa0` (run `45364845662`), with autoplay restrictions enabled. The graph smoke uses a same-origin generated PCM fixture; it is not a multichannel or Atmos decode test.
- Earlier iPad CSS structure audit, TypeScript, ESLint, unit tests and production build passed on commit `aeb2c7b9` (Verify run `45364845773`).
- The exact current head `f6f0309c4129b44ffd54473740824b5be5484f7a` passed iPad Edition Verify (run `45373955182`), Resource Playback Verification (`45373955096`), HLS Browser Playback Smoke (`45373955327`) and HLS External Stream Smoke (`45373955245`). This verifies software gates only; it is not Preview or physical-device acceptance.
- The isolated Ubuntu iPad Preview for exact head `f6f0309c4129b44ffd54473740824b5be5484f7a` is queued/pending as run `45373944056`. No exact-head Preview visual audit or physical iPad/Safari regression has passed yet.

## Remaining acceptance requirements

- **P1:** validate metadata against controlled/licensed real elementary-stream samples and matching HLS manifests; parser fixtures alone are insufficient.
- **P2:** add real multichannel CORS-safe HLS/MSE, Safari AudioContext, suspend/resume and failure-recovery evidence. No Atmos object renderer or codec decoder is implemented.
- **P3:** extend the initial direct-media session to an independently-owned hls.js/MSE pipeline; bind real HLS audio-track identity and switching; complete UI state/accessibility, interruption recovery, mute semantics and repeated source/episode race tests; pass the full [lifecycle matrix](./P3-LIFECYCLE-TEST-MATRIX.md), exact-head Preview and real Safari/iOS checks.
- **P4:** test physical iPhone/iPad, AirPods/Bluetooth, USB-C, HDMI and named AVR/Soundbar chains. These cannot be inferred from CI.
- **P5:** validate diagnostics on those physical output chains; unsupported platform fields remain unknown/null.
- **P6:** pass exact-head CI, isolated Preview visual audit and real Safari/iOS regression. Simulated Chromium viewport tests are not real iPad acceptance.

PR #99 must remain Draft. Do not merge, modify `main`, or deploy production as part of this work.
