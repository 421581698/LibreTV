# Dolby Immersive Audio Engine 2.0 — P1–P6 acceptance ledger

Updated: 2026-11-24  
Scope: `421581698/LibreTV`, branch `feature/libretv-ipad-edition-product`, PR #99 (Draft)

This ledger distinguishes implemented code from evidence that requires real media, hardware, or legal review. A phase is not accepted merely because its unit tests pass.

## P1 — Format and signal recognition

**Code scope implemented**
- Declared codec recognition: AC-3, E-AC-3, E-AC-3/JOC, AC-4 (including the four-part profile), TrueHD, Dolby MAT transport marker, DTS, DTS-HD, DTS:X, AAC, PCM/LPCM, IAMF and Eclipsa.
- HLS audio rendition inspection reads declared `CHANNELS` and `CODECS` metadata and hls.js audio-track metadata.
- JOC is detected from either the channel declaration or codec token, but remains metadata only.
- Six channels are not promoted to a 5.1 layout without explicit layout evidence.
- The telemetry sanitizer and diagnostics HUD retain the expanded enum set without retaining URLs, tokens or rendition names.

**Acceptance still required**
- Cross-check the declared metadata against actual audio elementary-stream samples and real HLS manifests from controlled fixtures.
- Verify parser results against real AC-3, E-AC-3/JOC, AC-4, TrueHD, MAT, DTS-family, AAC/PCM and IAMF/Eclipsa media. A manifest declaration alone is not bitstream validation.

## P2 — Decode and spatial-render research

**Implemented foundation**
- Standalone Web Audio presentation engine with opt-in stereo HRTF virtualization and a gated 5.1-to-binaural route.
- 5.1 routing requires an explicitly verified speaker layout; unknown layouts bypass processing.
- CORS checks reject cross-origin direct media without a CORS mode and now reject Blob URLs belonging to a different origin.
- The engine preserves a native bypass path when spatial processing is disabled.

**Not implemented**
- No E-AC-3/JOC, AC-4 or TrueHD decoder is bundled.
- No Atmos object renderer is integrated.
- No 7.1 renderer, dynamic object panning or head tracking is implemented.
- OpenJOC remains research-only: it is not a drop-in browser/WASM decoder and does not restore the original authored Atmos master.

**Acceptance still required**
- A browser AudioContext graph harness with real CORS-safe media, graph teardown, resume/suspend and failure-path tests.
- Separate decoder feasibility and licensing review before any decoder or renderer is considered for shipping.

## P3 — PlayerShell integration and lifecycle

**Status: blocked by lifecycle design; not enabled**
- The spatial module is not attached to PlayerShell and no spatial-audio user control is exposed.
- PlayerShell reuses its video element across episodes and providers. Once `createMediaElementSource()` is attached, disconnecting the graph does not restore the native media path for that same element.
- Enabling the engine without a proven element-replacement or all-sources-CORS-safe lifecycle can silently mute later direct MP4/native-HLS sources.
- Safari native HLS must remain untouched. AudioContext creation/resume must originate from an explicit user gesture.

**Acceptance still required**
- Prove a source-switch lifecycle that cannot carry an unsafe Web Audio attachment into a later source.
- Verify track switching continuity, volume/rate controls, pause/resume, unmount, episode changes and recovery.
- Demonstrate failure always falls back to native playback without muting or rebuilding the existing player unexpectedly.

## P4 — Physical output-chain verification

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
- Explicitly reports that browser APIs do not expose the selected output-device name here, spatial rendering is not yet integrated, native Dolby decode and bitstream passthrough are unverified, and Atmos object decode is not established.
- Copyable report remains telemetry-whitelisted and must not contain media URLs, tokens or rendition names.

**Acceptance still required**
- Validate the report on each real device/output chain and add a concrete failure reason only when it can be sourced from a reliable platform signal.
- Do not fabricate decoder identity, output-device identity, bitstream state or Atmos state when the browser does not expose them.

## P6 — Cross-platform regression and release gate

**Automated coverage present**
- Vitest unit coverage for format parsing, JOC metadata, HLS rendition inspection, CORS guards, spatial routing decisions and diagnostics sanitization.
- Repository workflows cover TypeScript, ESLint, unit tests, production build, HLS browser smoke and external HLS smoke.

**Acceptance still required**
- Chromium desktop, macOS Safari, iPhone Safari and iPad Safari.
- iPhone/iPad built-in speakers, AirPods/Bluetooth, USB-C, HDMI and named home-theater output chains.
- TestSprite/Playwright regression evidence plus real-device evidence reports.
- Confirm ArtPlayer, hls.js, Safari native HLS, source switching and audio-track switching remain stable.

## Release decision

P1's parser and telemetry code changes are implemented, but P1's real-bitstream cross-validation remains open. P2 is a presentation foundation and research track, not an Atmos decoder. P3 is not integrated. P4 is not physically verified. P5 is a truthful read-only HUD, not a complete decoder/output analyzer. P6's real-device matrix is not complete.

Therefore P1–P6 are **not all accepted**. Keep PR #99 Draft. Do not merge, deploy production, or claim Dolby Atmos playback until the corresponding evidence is recorded. Browser-native playback remains the default and safety fallback.
