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
- The engine provides an unprocessed Web Audio passthrough when spatial processing is disabled; this is not a return to the browser-native media path. Once attached, playback remains dependent on that AudioContext and the media element's one-shot binding.
- The engine enforces the one-shot `MediaElementAudioSourceNode` binding per video element, refuses reattachment after final teardown, and closes a newly created context if graph construction fails.
- Node-based tests exercise the mocked graph lifecycle, explicit resume, bypass, teardown and reattachment rejection; this is not a substitute for real-browser media tests.

**Not implemented**
- No E-AC-3/JOC, AC-4 or TrueHD decoder is bundled.
- No Atmos object renderer is integrated.
- No 7.1 renderer, dynamic object panning or head tracking is implemented.
- OpenJOC remains research-only: it is not a drop-in browser/WASM decoder and does not restore the original authored Atmos master.

**Acceptance evidence**
- **Verified on commit `aeb2c7b9a54900698dd5cfb2ebb4e044927f0fa0`**: GitHub Actions run `45364845662` passed both real Chromium HLS playback and Web Audio spatial-graph smoke. The graph harness exercises a generated same-origin PCM WAV, explicit user-gesture `AudioContext.resume()`, HRTF graph routing, bypass, teardown and CORS guard. The browser was run without disabling autoplay restrictions. This closes the Chromium graph-smoke sub-gate only; it does not cover Safari or real multichannel/Atmos streams.

**Acceptance still required**
- Additional browser coverage is still required for real multichannel CORS-safe HLS/MSE media, Safari AudioContext behavior, suspend/resume and failure recovery.
- Separate decoder feasibility and licensing review before any decoder or renderer is considered for shipping.

## P3 — PlayerShell integration and lifecycle

**Status: intentionally blocked; integration design decision recorded**
- The spatial module is not attached to PlayerShell and no spatial-audio user control is exposed. This is deliberate safety behavior, not a completed integration.
- PlayerShell creates ArtPlayer once and reuses `art.video` while `setupHls()` / `setupDirectMedia()` repeatedly change the source. Direct MP4/WebM and Safari native HLS explicitly remove `crossorigin`; hls.js owns its own MSE pipeline and audio-track lifecycle.
- `createMediaElementSource()` is a one-shot binding for a given media element. Disconnecting or destroying the current graph does not restore the element's native media path, and the browser does not provide a supported way to recreate a fresh source node for that same element.
- Therefore an opt-in toggle on the existing video element is not safe: a later cross-origin direct source or Safari native HLS source could be rendered silent after the element was already captured by Web Audio.
- **Decision:** do not attach Web Audio to the current reusable `art.video`. Keep browser-native playback as the default. Any future integration must use a separately owned media element per spatial session (or a new player instance with a proven replacement lifecycle), gate entry on verified CORS-readable media and supported browser capabilities, create/resume AudioContext only from a user gesture, and destroy the entire spatial session before returning to a native playback element. Never attempt to "detach" and reuse a captured element as a native fallback.
- Safari native HLS remains on the existing untouched path. No changes to `PlayerShell` are justified until a browser test proves that source transitions cannot inherit an unsafe Web Audio binding.

**Acceptance still required**
- Implement an isolated spatial-session/player architecture that does not reuse a Web-Audio-captured media element for native playback.
- Verify track switching continuity, volume/rate controls, pause/resume, unmount, episode changes and recovery across direct MP4/WebM, hls.js MSE and Safari native HLS.
- Demonstrate failure returns to a separate native media element and never attempts to reuse a captured element as a native fallback.
- Until those tests exist, P3 remains blocked and no PlayerShell integration should be merged.

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
- Vitest unit coverage for format parsing, JOC metadata, HLS rendition inspection, CORS guards, spatial routing decisions, one-shot Web Audio lifecycle, and diagnostics sanitization.
- Repository workflows cover TypeScript, ESLint, unit tests, production build, HLS browser smoke, external HLS smoke, and now a real Chromium Web Audio spatial-graph smoke.

**Acceptance still required**
- Chromium desktop, macOS Safari, iPhone Safari and iPad Safari.
- iPhone/iPad built-in speakers, AirPods/Bluetooth, USB-C, HDMI and named home-theater output chains.
- TestSprite/Playwright regression evidence plus real-device evidence reports.
- Confirm ArtPlayer, hls.js, Safari native HLS, source switching and audio-track switching remain stable.

## Release decision

P1's parser and telemetry code changes are implemented, but P1's real-bitstream cross-validation remains open. P2 is a presentation foundation and research track, not an Atmos decoder; its real-Chromium HLS and Web Audio graph smoke sub-gate passed on `b74c4d20`, while Safari, real multichannel media and hardware validation remain open. P3 is not integrated. P4 is not physically verified. P5 is a truthful read-only HUD, not a complete decoder/output analyzer. P6's real-device matrix is not complete.

On commit `aeb2c7b9`, P6 software gates (CSS structure, TypeScript, ESLint, unit tests, production build, Chromium HLS, Chromium Web Audio graph, external HLS, and Resource Playback Verification) all passed. The isolated iPad Preview visual audit is still running and is not included in that result.

Therefore P1–P6 are **not all accepted**. Keep PR #99 Draft. Do not merge, deploy production, or claim Dolby Atmos playback until the corresponding evidence is recorded. Browser-native playback remains the default and safety fallback.
