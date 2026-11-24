# Dolby Immersive Audio Engine 2.0 — P1–P6 acceptance ledger

Updated: 2026-11-24  
Scope: `421581698/LibreTV`, branch `feature/libretv-ipad-edition-product`, PR #99 (Draft)

This ledger distinguishes implemented code from evidence that requires real media, hardware, or legal review. A phase is not accepted merely because its unit tests pass.

## P1 — Format and signal recognition

**Code scope implemented**
- Declared codec recognition: AC-3, E-AC-3, E-AC-3/JOC, AC-4 (including the four-part profile), TrueHD, Dolby MAT transport marker, DTS, DTS-HD, DTS:X, AAC, PCM/LPCM, IAMF and Eclipsa.
- HLS audio rendition inspection reads declared `CHANNELS` and `CODECS` metadata and hls.js audio-track metadata. HLS sample-entry matching is exact (including `dtsx`) and malformed prefixes fail closed.
- JOC is detected from either the channel declaration or codec token, but remains metadata only.
- Six channels are not promoted to a 5.1 layout without explicit layout evidence.
- The telemetry sanitizer and diagnostics HUD retain the expanded enum set without retaining URLs, tokens or rendition names.

**Acceptance still required**
- Cross-check the declared metadata against actual audio elementary-stream samples and real HLS manifests from controlled fixtures.
- Verify parser results against real AC-3, E-AC-3/JOC, AC-4, TrueHD, MAT, DTS-family, AAC/PCM and IAMF/Eclipsa media. A manifest declaration alone is not bitstream validation.

## P2 — Decode and spatial-render research

**Implemented foundation**
- Standalone Web Audio presentation engine with opt-in stereo HRTF virtualization and a gated 5.1-to-binaural route.
- The isolated HLS spatial session passes the selected rendition's declared channel count into the engine: declared stereo can use stereo HRTF virtualization; six-channel input remains bypassed unless an explicit 5.1 layout is verified. Live HLS track changes update the engine route.
- 5.1 routing requires an explicitly verified speaker layout; unknown layouts bypass processing.
- CORS checks reject cross-origin direct media without a CORS mode and now reject Blob URLs belonging to a different origin.
- The engine provides an unprocessed Web Audio passthrough when spatial processing is disabled; this is not a return to the browser-native media path. Once attached, playback remains dependent on that AudioContext and the media element's one-shot binding.
- The engine enforces the one-shot `MediaElementAudioSourceNode` binding per video element, refuses reattachment after final teardown, and closes a newly created context if graph construction fails.
- Node-based tests exercise the mocked graph lifecycle, explicit resume, bypass, teardown and reattachment rejection; this is not a substitute for real-browser media tests.

**Not implemented**
- No E-AC-3/JOC, AC-4 or TrueHD decoder is bundled.
- No Atmos object renderer is integrated.
- No 7.1 renderer, dynamic object panning or head tracking is implemented.
- OpenJOC remains research-only: it is not a drop-in browser/WASM decoder and does not restore the original authored Atmos master.

**Acceptance evidence**
- **Verified on commit `aeb2c7b9a54900698dd5cfb2ebb4e044927f0fa0`**: GitHub Actions run `45364845662` passed both real Chromium HLS playback and Web Audio spatial-graph smoke. The graph harness exercises generated same-origin stereo and six-channel PCM WAV fixtures (the latter declares a 5.1 speaker mask), explicit user-gesture `AudioContext.resume()`, HRTF graph routing, bypass, teardown and CORS guard. The workflow also runs a Playwright WebKit graph smoke, which is not macOS/iOS Safari device acceptance. Browser playback of generated PCM validates the Web Audio routing graph only; it does not validate encoded AC-3/E-AC-3/JOC, AC-4, TrueHD, DTS or IAMF decoding, nor Atmos object rendering or bitstream passthrough. This closes the browser PCM graph-smoke sub-gate only.

**Acceptance still required**
- Additional browser coverage is still required for real multichannel CORS-safe HLS/MSE media, Safari AudioContext behavior, suspend/resume and failure recovery.
- Separate decoder feasibility and licensing review before any decoder or renderer is considered for shipping.

## P3 — PlayerShell integration and lifecycle

**Status: isolated direct-media and HLS session paths implemented; full phase not accepted**

- `src/lib/spatial-media-session.ts` owns a distinct media element for direct MP4/WebM and HLS. It verifies source CORS before allocation, sets CORS mode before source assignment, activates Web Audio only from an explicit user gesture, synchronizes playback state, and restores the untouched ArtPlayer element on fallback/disposal.
- `src/components/player-shell.tsx` exposes an opt-in two-step prepare/activate control and creates an independent hls.js/MSE controller for the spatial element when supported, or a separate native-HLS controller on Safari when hls.js/MSE is unavailable. Fatal HLS errors dispose the isolated pipeline and fall back to the original ArtPlayer route.
- The spatial session exposes its own HLS audio-track list and selection method; the existing audio-track UI routes selection to the spatial HLS instance while active. Native Safari HLS track access is used only when the platform exposes `audioTracks`. The original ArtPlayer video and its HLS instance are never captured by Web Audio.
- Lifecycle tests cover direct-media and isolated HLS preparation, independent element identity, CORS failure, HLS track selection and teardown, activation, pause/resume/seek/rate/volume synchronization, mute/error/context-interruption fallback, idempotent disposal, and activation/dispose races.
- Exact-head software CI passed on `f6f0309c4129b44ffd54473740824b5be5484f7a`: iPad Edition Verify run `45373955182`, Resource Playback Verification run `45373955096`, HLS Browser Playback Smoke run `45373955327`, and HLS External Stream Smoke run `45373955245`.

**Acceptance still required**
- Verify real HLS manifest, alternate playlist, media segment, encryption-key and redirect CORS behavior using controlled/licensed multi-track fixtures; the manifest preflight alone does not prove every resource is readable.
- Full P3 lifecycle matrix, including AudioContext interruption/recovery and browser-level fallback continuity.
- Exact-head Ubuntu Preview audit and real Safari/iPhone/iPad regression. Chromium CI is not Safari or physical-device evidence.

Safari native HLS and the existing ArtPlayer/hls.js route remain the default protected playback path; the spatial path uses a separate media element and independently owned pipeline. P3 core integration is implemented, but P3 is not finally accepted until automated, Preview and device evidence is recorded.

## P4 — Physical output-chain verification

Execution matrix: [P4 physical device and output-chain acceptance matrix](./ENGINE-2.0-P4-DEVICE-OUTPUT-MATRIX.md). The matrix is a recording template only; no physical-device result is implied by its creation.

**Not run; hardware evidence required**
- iPhone/iPad built-in speakers.
- AirPods and other Bluetooth outputs.
- USB-C audio output.
- HDMI output and a named Atmos-capable AVR/soundbar.

For every device/output combination, record separately: OS/browser decode, PCM output, Dolby bitstream passthrough, and actual Atmos object output. A device's general Atmos capability does not prove that LibreTV delivered Atmos to it.

## P5 — Diagnostics and evidence report

**Read-only HUD implemented; capability coverage expanded**
- Shows declared codec/container, AC-4 source metadata, JOC hints, HLS rendition count/channel declarations, browser decode hints and playback health.
- Shows AudioContext, MediaSource and MediaCapabilities availability, reported maximum output channels and output latency when exposed by the browser.
- Explicitly reports that browser APIs do not expose the selected output-device name here, the integrated spatial path is limited to stereo HRTF presentation, native Dolby decode and bitstream passthrough are unverified, and Atmos object decode is not established.
- Copyable report remains telemetry-whitelisted and must not contain media URLs, tokens or rendition names.

**Acceptance still required**
- Validate the report on each real device/output chain and add a concrete failure reason only when it can be sourced from a reliable platform signal.
- Do not fabricate decoder identity, output-device identity, bitstream state or Atmos state when the browser does not expose them.

## P6 — Cross-platform regression and release gate

**Automated coverage present**
- Vitest unit coverage for format parsing, JOC metadata, HLS rendition inspection, CORS guards, spatial routing decisions, one-shot Web Audio lifecycle, and diagnostics sanitization.
- Repository workflows cover TypeScript, ESLint, unit tests, production build, HLS browser smoke, external HLS smoke, and now a real Chromium Web Audio spatial-graph smoke.

**Acceptance still required**
- Chromium desktop, macOS Safari, iPhone Safari and iPad Safari.
- iPhone/iPad built-in speakers, AirPods/Bluetooth, USB-C, HDMI and named home-theater output chains.
- TestSprite/Playwright regression evidence plus real-device evidence reports.
- Confirm ArtPlayer, hls.js, Safari native HLS, source switching and audio-track switching remain stable.

## Release decision

P1 parser/metadata recognition and P5 read-only diagnostics are implemented at the software level; both still require controlled real-stream/device evidence. P2 provides stereo HRTF and explicitly gated 5.1 presentation primitives, not a Dolby decoder or Atmos object renderer. P3 has isolated MP4/WebM/HLS sessions and initial lifecycle/track-selection coverage; real segment/key CORS fixtures, full lifecycle matrix and device evidence remain open. P4 physical output-chain testing has not been performed. P6 iPad Edition Verify (`45378508106`), Resource Playback Verification (`45378507893`) and HLS External Stream Smoke (`45378507620`) passed on code head `3a607107a16d21320231877a281df48345fcef4e`; HLS Browser Playback Smoke (`45378507613`) was still running. The exact-head Ubuntu Preview run `45378499085` remained pending.

Therefore P1–P6 are **not all accepted**. Do not claim Atmos bitstream decoding, object rendering, or passthrough. Keep PR #99 Draft; do not merge, modify `main`, or deploy production. Browser-native playback remains the default and safety fallback.