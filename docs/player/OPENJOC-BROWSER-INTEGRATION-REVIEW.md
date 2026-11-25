# OpenJOC Browser Integration Review

Review date: 2026-11-25.

## Reference reviewed

- Project: https://github.com/chyinan/OpenJOC-Browser
- Reviewed revision: `34b39f468eb4e2384a2a5b24960a690535153f61`
- License: Apache-2.0.
- The project is a Chromium extension integration, not a drop-in web-player package; its package metadata marks the browser extension package private.

The useful architectural ideas are bounded CMAF extraction, Worker-based OpenJOC WASM decoding, generation-scoped lifecycle, timestamped PCM, bounded backpressure, AudioWorklet output, and synchronization to the video media clock.

## Reusable architecture

LibreTV adopts the following boundaries:

1. Keep the existing HTML video element as the master playback clock.
2. Keep ISO-BMFF transport parsing in the application layer and E-AC-3/JOC semantics in the pinned decoder.
3. Extract complete CMAF samples with exact byte boundaries and timestamps.
4. Decode in a dedicated Worker and copy PCM out of WASM memory before reuse.
5. Transfer bounded timestamped PCM to an AudioWorklet.
6. Enforce queue budgets, cancellation, source-generation isolation, discontinuity resets, and native-audio fallback.
7. Suppress original media audio only after validated PCM is ready and the first aligned output quantum has rendered.

## Not transplanted

The reference implementation is specific to Bilibili and its browser-extension environment: MAIN-world page hooks, Bilibili playurl state, site URL allowlists, service-worker/offscreen-document ownership, and extension messaging. LibreTV does not copy those hooks, URL assumptions, extension APIs, credentials/referrer assumptions, or site entitlement logic. The private extension package is not used as an npm dependency. This branch adopts reviewed architecture, not unreviewed source or bundled HRTF assets.

## LibreTV implementation status

The existing fMP4 parser is extended by `JocCmafPacketExtractor` and a read-only hls.js fragment tap. The extractor binds a selected audio track, enforces bounded sample count/size/payload, extracts complete sample bytes and timestamps, and propagates discontinuities.

The browser runtime now includes:
- pinned OpenJOC v0.20.2 WASM build and Worker ABI;
- `dec3` parsing and CMAF-JOC profile admission;
- in-band I0 BSI checks and D0 `chanmap` to `chan_loc` agreement;
- synthetic I0+D0 extraction/mismatch tests;
- timestamped PCM transport and bounded AudioWorklet output;
- explicit opt-in activation and fail-open restoration of native media audio.

The default ArtPlayer + hls.js / Safari native-HLS playback path remains unchanged. The observer is available only on the hls.js path; Safari native-HLS does not expose fragments to this observer.

## Evidence and remaining gates

| Gate | Current evidence | Remaining limitation |
|---|---|---|
| CMAF extraction | Complete bounded samples, track binding, timestamps, discontinuities | Real production-media coverage |
| hls.js tap | Read-only fragment observer, init/media extraction | No Safari native-HLS fragment observation |
| OpenJOC WASM | Pinned build, upstream bridge tests, WASM integration | Not a licensed Dolby decoder |
| JOC track admission | Parsed `dec3`, 48 kHz profile, type-A extension and complexity/bitrate limits | Full semantic validation remains in OpenJOC |
| I0/D0 binding | I0 BSI and D0 channel-map metadata checks; synthetic I0+D0 extractor tests | Genuine I0+D0 media decode and independent PCM reference comparison |
| PCM output | Timestamped stereo PCM, bounded queue, AudioWorklet and fallback logic | Real-device A/V sync and long-play validation |
| Native adapters | iOS Swift and Android Kotlin adapter-library tests pass | Not complete app shells or trusted host/player integration |
| Physical devices | No physical-device acceptance claimed | iPhone/iPad/Android output-route, performance and thermal tests |

CI on the current PR head passes the browser runtime workflow, full repository tests, TypeScript, lint, general verification, resource/collector verification, iOS adapter tests, Android adapter tests, and pinned OpenJOC candidate tests. The separate Cloudflare Workers Build check remains failed; the isolated Cinema V2.3 Preview workflow is skipped and is not represented as a deployed preview.

A successful software path may be labeled `software JOC decode` only when the decoder confirms a supported in-band profile and emits PCM for the active source generation. This does not mean native Dolby passthrough, native Atmos output, authored-object recovery, Dolby certification, or equivalence to a licensed renderer.
