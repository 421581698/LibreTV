# OpenJOC Browser Runtime

Status: experimental, opt-in, and not a production default.

## Pinned decoder and reproducible build

The browser decoder is built from OpenJOC v0.20.2, pinned at:

`f9b54bbbb8e1b44c746a72e1b14b289cad418cf9`

Build locally before packaging the Next.js application:

```bash
npm ci
npm run build:openjoc-wasm
npm run build
```

The build writes `public/wasm/openjoc_wasm.wasm` and records the upstream license, target-specific Cargo dependency tree, pinned build manifest, and generated WASM SHA-256. The WASM binary is generated rather than committed. Normal application builds do not silently install Rust or fetch upstream source.

## Experimental query modes

- `?jocTap=1`: read-only observation of hls.js fragments and bounded CMAF sample extraction.
- `?jocDecode=1`: additionally decode extracted access units in the pinned OpenJOC Worker and report decoder evidence without changing audio output.
- `?jocOutput=1`: additionally allow the software PCM AudioWorklet route. A user gesture is required. The original media audio is muted only after a supported decoder profile, at least 128 ms of queued PCM, and the first timestamp-aligned AudioWorklet output quantum. Failure paths restore native media audio.

These modes are experimental. They do not establish native Dolby or Atmos output.

## Implemented runtime boundaries

- Existing ArtPlayer + hls.js MSE ownership remains unchanged; there is no second media element or MSE pipeline.
- The fragment tap is read-only and works only on the hls.js path. Safari native-HLS does not expose its fragments to this observer.
- The selected track must be a `soun` track with an `ec-3` sample entry and a parsed `dec3` configuration.
- The browser parser enforces the pinned OpenJOC CMAF-JOC track profile: 48 kHz, one independent I0, optional single D0, type-A JOC extension signal, complexity index at most 16, and data rate at most 3024 kbps.
- Per-sample structural validation admits one complete 1536-sample, six-block I0 access unit, optionally followed by D0. It checks supported stream type/substream IDs, syncframe boundaries, sample-rate/block profile, and in-band I0 BSI against `dec3`.
- When D0 is present, its in-band `chanmap` is mapped to `chan_loc` and compared with `dec3`. Unsupported mappings and mismatches are rejected.
- These browser-side checks bind container metadata and the BSI fields needed for admission; they are not a replacement for the full upstream E-AC-3/JOC semantic validator. OpenJOC still owns JOC/EMDF interpretation and decoding.
- The Worker copies PCM out of WASM memory before decoder-frame reuse. PCM output is Float32 stereo at 48 kHz.
- The AudioWorklet queue is bounded to one second; decoder backpressure is applied at 500 ms. Input samples are capped at 1 MiB and WASM linear memory at 256 MiB.
- CMAF PTS is mapped onto the hls.js timeline using `frag.start` as an anchor. Missing anchors are rejected rather than guessed. Seek, source-generation changes, init changes, discontinuities, unsupported playback rates, underruns, overflow, and decoder errors trigger reset/fallback handling.
- Software output requires AudioWorklet, a secure context, a 48 kHz AudioContext, and a user gesture.

## Current CI evidence

The current PR-head integration run remuxes the upstream OpenJOC JOC E-AC-3 fixture into fragmented MP4, adds the CMAF JOC type-A `dec3` extension to test-only container metadata (FFmpeg omits it), extracts seven CMAF samples, and sends the original E-AC-3 sample bytes through the pinned OpenJOC WASM ABI to PCM.

Pinned regression baseline:
- CMAF samples: 7
- Decoded access units: 7
- PCM frames: 1568
- Decoder profile: `etsi-strict`
- PCM regression SHA-256: `7e8dc2f9a3671fc9e14e5c9ead03c7d88dcd5ee51fa9ab99f27f58b00b0a8318`

This is a deterministic regression baseline, not an independently authored reference master. The upstream media fixture used in this CMAF integration run is I0-only. Synthetic I0+D0 extraction and `dec3`/channel-map binding tests pass, but genuine I0+D0 media decoding and dependent-substream PCM reference comparison are not yet established.

## Acceptance still required

Before enabling this outside opt-in testing:

1. Run authorized production E-AC-3 JOC CMAF media through the complete browser Worker/Worklet path, including genuine I0+D0 media, and compare PCM with an independently checked reference.
2. Validate seek, preroll, discontinuity, source switching, and A/V drift against real media timestamps.
3. Measure queue pressure, underrun recovery, CPU, memory, latency, and long-play behavior in Safari and Chromium on physical devices.
4. Verify native-audio restoration on every failure path and test iPhone, iPad, and Android device routes.
5. Complete trusted native-host integration separately. The Swift/Kotlin modules are adapter libraries, not complete native apps.

OpenJOC software decode currently outputs stereo PCM. It is not a licensed Dolby decoder, native Atmos bitstream passthrough, authored-object-preserving renderer, Dolby-certified renderer, or Dolby certification.
