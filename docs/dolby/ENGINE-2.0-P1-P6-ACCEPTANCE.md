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

**Automated parser evidence (latest code head)**
- Exact HLS `CODECS` token matching rejects malformed prefixes, validates MPEG-4 audio object identifiers, handles DTS:X `dtsx`, and keeps conflicting variant declarations unknown. Exact-head iPad Edition Verify run `45386453845` passed on commit `683b4d2676df18db2d7abdc31cf09a561b8be02d`, including CSS structure audit, TypeScript, ESLint, unit tests and production build.

**Acceptance still required**
- Cross-check the declared metadata against actual audio elementary-stream samples and real HLS manifests from controlled fixtures.
- Verify parser results against real AC-3, E-AC-3/JOC, AC-4, TrueHD, MAT, DTS-family, AAC/PCM and IAMF/Eclipsa media. A manifest declaration alone is not bitstream validation.

### P1 fixture-source review (research only; no media copied into this repository)

The following public sources are candidates for controlled parser/stream tests. A source being publicly reachable is not, by itself, permission to redistribute its media. Do not vendor any binary until the exact file's license and attribution are checked.

- Chromium `media/test/data` documents `bear.ac3` and `bear.eac3` as files converted from `bear.ogv`; it also documents three AC-4 elementary streams (A-JOC, channel-based, IMS) as encoded by Dolby. The AC-4 provenance is explicit, but a per-file redistribution grant was not established in this review; keep those files out of the repository pending permission review.
- The same Chromium README documents `dts.bin` and `dtsx.bin` as single DTS/DTS:X frames. These are useful only as narrow frame-parser fixtures, not full programme/playback validation. Its `bear_dtsc.mp4`, `bear_dtse.mp4`, and `bear_dtsx.mp4` examples are described as moov-only files without media payload, so they must not be counted as bitstream playback evidence.
- Chromium's IAMF examples (`iamf_alternating_sine_waves_714.mp4`, stereo, and 96 kHz FLAC variants) are generated from synthetic sine/silence sources. They can validate IAMF container/layout parsing and supported decode paths, but do not prove authored Atmos objects or Dolby decoding.
- AOMedia's Android `iamf-tools` repository publishes standalone IAMF, fragmented MP4, standalone MP4, and rendered-WAV test-vector groupings; the repository states a BSD 3-Clause Clear License. Verify the exact testdata file and attribution before copying it into this repository.
- ICL Forge publishes 60 self-generated AC-3/E-AC-3 vectors, including E-AC-3/JOC object metadata, with source PCM and a project license. Its own documentation says the inputs are synthetic and that the set has no AC-4 or TrueHD vector; it is a useful independent implementation comparison, not a normative conformance suite.
- Do not use the open-media-test-corpus files from sources marked “license undeclared” (including filesamples.com and samplelib.com). Its own credits explicitly distinguish these from BSD/CC0/CC-BY sources and say the media files retain their individual source licenses.

Source references:
- Chromium media fixtures and generation notes: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/test/data/README.md
- AOMedia IAMF tools and license: https://android.googlesource.com/platform/external/iamf_tools/
- ICL Forge conformance-vector scope and license: https://iainchesworthlabs.github.io/iclforge/conformance-vectors/
- Open media corpus per-source attribution: https://github.com/bandusix/open-media-test-corpus/blob/main/CREDITS.md

**Result of this review:** candidate sources now exist for portions of AC-3/E-AC-3/JOC, AAC/PCM, DTS frame parsing, AC-4 metadata/container inspection, and IAMF. No fully cleared, broad test set has been assembled. TrueHD/MAT and complete DTS-family coverage remain unresolved. This review does not change P1 acceptance status and does not claim a real-stream test has run.
 
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
- **Verified on commit `1bba4178fd1d61393f71036adfef6c6bc0cfe727`**: exact-head GitHub Actions passed iPad Edition Verify (`45385604698`), Resource Playback Verification (`45385604560`), HLS Browser Playback Smoke (`45385604657`) and HLS External Stream Smoke (`45385604428`). Browser smoke passed real Chromium HLS playback, Chromium Web Audio spatial graph with generated same-origin stereo and six-channel PCM WAV fixtures (the latter declares a 5.1 speaker mask), explicit user-gesture `AudioContext.resume()`, HRTF graph routing, bypass, teardown and CORS guard, plus a Playwright WebKit graph smoke. WebKit here is not macOS/iOS Safari device acceptance. Generated PCM validates the Web Audio routing graph only; it does not validate encoded AC-3/E-AC-3/JOC, AC-4, TrueHD, DTS or IAMF decoding, nor Atmos object rendering or bitstream passthrough. This closes browser PCM graph-smoke sub-gates only.

**Acceptance still required**
- Additional browser coverage is still required for real multichannel CORS-safe HLS/MSE media, Safari AudioContext behavior, suspend/resume and failure recovery.
- Separate decoder feasibility and licensing review before any decoder or renderer is considered for shipping.

## P3 — PlayerShell integration and lifecycle

**Status: isolated direct-media and HLS session paths implemented; full phase not accepted**

- `src/lib/spatial-media-session.ts` owns a distinct media element for direct MP4/WebM and HLS. It verifies source CORS before allocation, sets CORS mode before source assignment, activates Web Audio only from an explicit user gesture, synchronizes playback state, and restores the untouched ArtPlayer element on fallback/disposal.
- `src/components/player-shell.tsx` exposes an opt-in two-step prepare/activate control and creates an independent hls.js/MSE controller for the spatial element when supported, or a separate native-HLS controller on Safari when hls.js/MSE is unavailable. Fatal HLS errors dispose the isolated pipeline and fall back to the original ArtPlayer route.
- The spatial session exposes its own HLS audio-track list and selection method; the existing audio-track UI routes selection to the spatial HLS instance while active. Native Safari HLS track access is used only when the platform exposes `audioTracks`. The original ArtPlayer video and its HLS instance are never captured by Web Audio.
- Lifecycle tests cover direct-media and isolated HLS preparation, independent element identity, CORS failure, HLS track selection and teardown, fatal HLS errors during startup and after activation, activation, pause/resume/seek/rate/volume synchronization, mute/error/context-interruption fallback, idempotent disposal, and activation/dispose races.
- Added `scripts/spatial-hls-resource-cors-smoke.mjs` to exercise browser CORS readability independently for master manifest, variant playlist, media segment, AES-128 key, cross-origin redirect target, and a deliberately denied resource. This is a resource-fetch/CORS matrix, not a valid encoded HLS decode/playback fixture; its exact-head CI result must be recorded before calling the automated sub-gate passed.
- Exact-head software CI passed on `f6f0309c4129b44ffd54473740824b5be5484f7a`: iPad Edition Verify run `45373955182`, Resource Playback Verification run `45373955096`, HLS Browser Playback Smoke run `45373955327`, and HLS External Stream Smoke run `45373955245`.

**Acceptance still required**
- Run the controlled browser CORS resource matrix on the exact current head; then add/verify a valid controlled HLS playback fixture covering playlist, segment and AES key fetch through hls.js. The CORS matrix alone does not prove HLS demux/decode or session fallback continuity.
- Full P3 lifecycle matrix, including browser-level fatal HLS fallback continuity, AudioContext interruption/recovery, and source/track race coverage.
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