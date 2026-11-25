# OpenJOC Browser Runtime

Status: experimental, opt-in, not a production default.

## Build

The browser decoder is built from the reviewed OpenJOC v0.20.2 source commit:

f9b54bbbb8e1b44c746a72e1b14b289cad418cf9

Run this before a local Next.js build:

```bash
npm ci
npm run build:openjoc-wasm
npm run build
```

The build command writes a same-origin WASM asset to public/wasm/openjoc_wasm.wasm and retains:
- the upstream OpenJOC license;
- a target-specific Cargo dependency tree;
- a pinned build manifest;
- the generated WASM SHA-256.

The WASM binary is generated, not committed. A deployment/build environment must explicitly run npm run build:openjoc-wasm before Next.js packaging. The normal build does not silently install Rust or fetch source code.

## Opt-in modes

- ?jocTap=1: observe hls.js fragments and extract bounded E-AC-3 CMAF samples only.
- ?jocDecode=1: additionally send complete extracted samples to the pinned OpenJOC Worker and discard PCM after decoder inspection.
- ?jocOutput=1: additionally create the AudioWorklet output lane. While video is playing, tap inside the player after timestamped PCM has buffered; the software lane only mutes the media element after decoder profile evidence, at least 128 ms of PCM, and the first timestamp-aligned AudioWorklet output quantum. On underrun, queue overflow, seek, unsupported playback rate, teardown, or decoder failure, native media audio is restored.

The opt-in modes are experimental. Do not use them as evidence of native Dolby/Atmos output.

## Runtime boundaries

- Existing ArtPlayer + hls.js MSE ownership remains unchanged.
- The HLS fragment tap is read-only and is available only on the hls.js path. Safari native-HLS does not expose these fragments to this tap.
- CMAF ec-3 is only a codec hint. Before decode, each sample must pass a bounded syncframe-envelope check for exactly one 1536-sample I0 access unit, optionally followed by D0; non-48-kHz, non-six-block, reordered, truncated, extra-substream, and unsupported-profile envelopes are rejected. OpenJOC must still report its decoded profile and access-unit counters before software output can be activated.
- The browser-side I0/D0 check is structural only. It does not yet validate the full `dec3` configuration, D0 channel-map/`chan_loc` agreement, JOC EMDF semantics, or dependent-substream PCM against a reference fixture. A structurally admitted D0 sample is not proof that D0 was correctly decoded.
- The Worker copies PCM out of WASM memory before releasing the decoder frame.
- PCM is Float32 stereo at 48 kHz. The bounded AudioWorklet queue is capped at one second; the decoder applies backpressure at 500 ms. Worker input samples are capped at 1 MiB and WASM linear memory is capped at 256 MiB.
- CMAF PTS is mapped to the hls.js fragment timeline using frag.start as an anchor. If that anchor is absent, the sample is rejected rather than guessed.
- The AudioWorklet follows an explicitly supplied video media clock. The browser integration currently supplies video.currentTime * 48000; a real fixture and device test must verify that the HLS fragment anchor and media element timeline agree for each supported source profile.
- Output requires a 48 kHz AudioContext, AudioWorklet, a secure context, and a user gesture to resume audio.

## Acceptance still required

Before enabling this outside opt-in testing:
1. Run the generated WASM against authorized real E-AC-3 JOC CMAF fixtures, including a CMAF sample containing I0+D0 with matching `dec3` channel metadata, and verify dependent-substream PCM against an independent reference; also cover seek, discontinuity, preroll, and malformed samples.
2. Verify profile/object evidence and reference PCM against an independently checked decode.
3. Measure A/V drift, queue pressure, underrun recovery, CPU, memory, and long-play behavior in Safari and Chromium on actual devices.
4. Verify that the native audio route is restored on every failure path.
5. Complete iOS/Android host integration and physical-device acceptance separately.

OpenJOC software decode and binaural rendering are not a native Dolby decoder, native Atmos bitstream passthrough, Dolby-certified renderer, or Dolby certification.
