# OpenJOC Browser Integration Review

Review date: 2026-11-25.

## Reference implementation reviewed

- Project: https://github.com/chyinan/OpenJOC-Browser
- Reviewed source revision: `34b39f468eb4e2384a2a5b24960a690535153f61`
- Project license: Apache-2.0.
- Project package metadata marks the browser extension package as private.
- The project is a Chromium extension integration, not a drop-in web-player package.

The reference implementation demonstrates a practical software JOC path:
bounded CMAF sample extraction, OpenJOC WASM decoding in a Worker, generation-scoped worker lifecycle, timestamped PCM transport, bounded backpressure, an AudioWorklet output queue, and synchronization to the video element's media clock.

## What is reusable as architecture

The following concepts are appropriate for LibreTV:

1. Keep the existing HTML video element as the master playback clock.
2. Parse only ISO-BMFF transport metadata in the application layer; keep E-AC-3/JOC/EMDF/OAMD semantics inside the pinned decoder.
3. Extract complete E-AC-3 CMAF samples with exact sample boundaries and media timestamps.
4. Decode in a dedicated Worker, not on the UI thread.
5. Copy PCM out of WASM memory before it can be reused.
6. Transfer bounded, timestamped PCM blocks to an AudioWorklet.
7. Enforce queue budgets, cancellation, source-generation isolation, discontinuity resets and native-audio fallback.
8. Suppress the media element's original audio only after the software path has produced validated, non-empty PCM for the active playback generation.

## What must not be transplanted unchanged

OpenJOC-Browser's site integration is specifically designed around the Bilibili page and its browser-extension contexts: MAIN-world page observation, Bilibili playurl state, Bilibili URL allowlists, service-worker/offscreen-document ownership and extension messaging.

LibreTV is a first-party web player using its existing ArtPlayer/hls.js/Safari-native-HLS ownership. Copying Bilibili page hooks, URL patterns, credentials/referrer assumptions, extension APIs or site-specific entitlement logic would be incorrect and unsafe.

The reference package is marked private, so LibreTV should not depend on it as an npm package. Any source-code reuse must be reviewed file-by-file, preserve Apache-2.0 notices and OpenJOC/SADIE II third-party attributions, and undergo a separate dependency and asset audit. This review adopts architecture, not copied source code or bundled HRTF assets.

## LibreTV work now present

The existing LibreTV fMP4 parser already provides bounded ISO-BMFF box parsing, init-track metadata, per-sample byte offsets, media timestamps and mdat containment validation.

A new `JocCmafPacketExtractor` builds on that parser and adds:

- explicit selected-track identity;
- strict `soun` + `ec-3` sample-entry admission;
- bounded per-segment sample count, per-sample size and aggregate payload bytes;
- extraction of complete sample payload views;
- decode/presentation timestamps, duration and native media timescale;
- propagation of track timeline discontinuities.

This is deliberately only a transport/sample-extraction layer. An `ec-3` sample entry is not proof of JOC. It does not decode the samples, identify an in-band JOC profile, render objects, synchronize PCM, or change the active player audio output.

## Next integration gates

| Gate | Required implementation/evidence | State |
|---|---|---|
| CMAF sample extraction | Track-bound complete E-AC-3 samples and bounded payload | Implemented; tests pending latest CI |
| hls.js fragment tap | Capture init/media fragments for the active source without taking over loader ownership | Not implemented |
| OpenJOC WASM runtime | Pin ABI/version, load only same-origin packaged WASM, worker cancellation and memory bounds | Candidate build passes; player runtime not integrated |
| JOC admission | Decoder-reported supported in-band profile and successful AU decode | Not implemented |
| PCM sync | Video master clock, timestamped PCM queue, discontinuity/seek/source reset | Not implemented |
| Audio switch | Mute native media only after validated PCM readiness; restore on every failure | Not implemented |
| Real fixtures | Authorized JOC CMAF fixtures with independently reviewed expected decode/output | Not run |
| Device/performance | Browser/device CPU, memory, latency, underrun and thermal testing | Not run |

## Evidence labels

A future successful software path may be labeled `software JOC decode` only after the decoder confirms a supported in-band JOC profile and emits PCM for the current source generation. It may be labeled `software binaural spatial render` only after the binaural renderer is actually selected and reports output frames.

Neither label means native Dolby passthrough, native Atmos output, authored-object recovery, Dolby certification, or exact equivalence to Dolby's licensed renderer.
