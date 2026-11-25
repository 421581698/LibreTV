# LibreTV Dolby Immersive Audio Engine 4.0

Status: engineering upgrade baseline added on `feature/dolby-immersive-audio-v4-2026-11-25`.
Base: `feature/cinema-engine-v2-3-integration`.
This document records implemented software contracts and explicit external acceptance gates. It does not claim Dolby certification, JOC decoding, native Atmos output, or physical-device acceptance.

## Scope and non-goals

- Keep the existing ArtPlayer + hls.js / Safari native-HLS playback ownership.
- Keep native media-element audio as the default and fail-open path.
- Keep the existing opt-in Web Audio spatial engine; never silently attach it to non-CORS media.
- Distinguish codec/manifest metadata, browser API availability, configured DSP, successful decode, object rendering, and physical output.
- Do not ship an unreviewed decoder, undocumented binary, or proprietary Dolby implementation.
- Do not describe HRTF virtualization as Dolby Atmos.
- Do not promise 7.1/7.1.4 support from browser channel-count metadata alone.

## Layered architecture

```text
Player / ArtPlayer / HLS source ownership
                 |
Audio Capability Manager
  browser API probe | source metadata | route constraints
                 |
Evidence & Policy Gate
  confidence | CORS | user gesture | supported layout
       |                  |                 |
Native media audio   Web Audio HRTF   Future native adapter
(default/fallback)   opt-in only       iOS / Android
       |                  |                 |
                 Output Verification
  native output evidence | JOC decode evidence | object-render evidence
  binaural configured state | fallback reason | diagnostics
```

## Current verified implementation inherited from V2.2/V2.3 integration

- HLS audio rendition inspection reads `CHANNELS`, codec hints and JOC marker.
- JOC is retained as metadata only; it is not proof of decode.
- Spatial processing is opt-in and requires a user gesture.
- CORS checks prevent attaching Web Audio to a media element that would become silent.
- Stereo HRTF virtualization and a guarded 5.1 binaural route exist; six-channel sources without verified speaker ordering bypass.
- PlayerShell exposes spatial-audio controls.
- Playback source ownership remains with the existing player path; no second media/MSE pipeline is created.
- Unit tests cover metadata parsing, CORS guards and spatial route decisions.

## Added in this 4.0 upgrade slice

- Added a version-1 native bridge snapshot validator with session/freshness checks, bounded values, enum validation and unknown-field stripping.
- Added isolated Swift and Kotlin native adapter libraries plus a platform build/test workflow definition. They report limited platform facts only; complete app-shell integration and physical-device acceptance remain external gates.
- Reviewed OpenJOC v0.20.2 as a candidate software JOC decoder (Apache-2.0 core); it is not vendored or integrated. See `docs/player/JOC-DECODER-ADOPTION-REVIEW.md`.

- A typed browser audio feature inventory for Web Audio, MediaElementAudioSourceNode, HRTF PannerNode, AudioWorklet, MediaCapabilities and WebCodecs AudioDecoder API presence.
- Evidence-based output classification with distinct states for native Dolby output, JOC decode plus object rendering, configured binaural processing, JOC-marker-only, stereo and unknown.
- Browser-only evidence deliberately leaves native Dolby output unknown and JOC/object decoding not integrated.
- Regression tests ensure a JOC marker cannot be promoted to decoded Atmos and HRTF cannot be mislabeled as Atmos.

## Capability boundaries

### Web / Safari

The browser can expose API availability and media metadata. It cannot reliably expose the operating system's final Dolby output route, headphone virtualization state, or proof that a browser pipeline decoded and rendered JOC objects. API presence is not proof of codec support or actual output.

### iOS / iPadOS native adapter

An isolated Swift Package now exists at `native/ios`. It reads the current AVAudioSession output route and emits the version-1 snapshot shape. It does not create a complete iOS app target, inspect a native player decoder, or prove Dolby/JOC/object rendering. Safari JavaScript cannot impersonate this adapter; a trusted native shell and real-device acceptance are still required.

### Android native adapter

An isolated Kotlin library now exists at `native/android`. It checks platform decoder capability for E-AC-3 JOC, reads Spatializer availability/enabled state where supported, and accepts the active output device from its host player. It is not a complete Android app target, is not yet wired to Media3 playback, and does not prove active JOC decoding or Dolby output. Browser JavaScript cannot query or assert these native states.

### JOC decoding

The current browser path does not extract complete E-AC-3 JOC access units and does not include a verified JOC decoder/object renderer. A future adapter requires:
1. upstream source, license and reproducible-build audit;
2. complete E-AC-3 access-unit extraction and framing;
3. decoder correctness against known fixtures;
4. object metadata parsing and renderer integration;
5. PTS/discontinuity/preroll mapping and bounded PCM queues;
6. AudioWorklet output, underrun handling and cancellation;
7. iPhone/iPad and Android performance/thermal acceptance.

No JOC WASM dependency is shipped by this upgrade slice.

## Acceptance gates

| Gate | Required evidence | Current status |
|---|---|---|
| Browser API inventory | deterministic feature-probe tests | Passed on commit `8f531c8`; rerun required for newer head |
| Audio metadata | HLS parser tests; JOC marker remains a hint | Existing tests |
| HRTF route | route-selection and CORS regression tests | Existing tests |
| Player integration | browser playback, source switch and teardown | CI verification passed on `8f531c8`; isolated Preview deployment/acceptance not yet confirmed |
| Native iOS Dolby | native app build + device output evidence | Not implemented |
| Native Android Dolby | native app build + device output evidence | Not implemented |
| JOC decode/object render | licensed decoder + reference fixtures + output evidence | Not implemented |
| Physical devices | real iPhone/iPad/Android device records | Not run |
| Performance | CPU/memory/latency/thermal measurements | Not run |

## Follow-up hardening in this branch\n\n- Missing HLS audio metadata now disables the spatial graph and resets the UI mode to off instead of leaving a stale enabled indicator.\n- Unsupported channel declarations take the same fail-open path.\n- Spatial-engine initialization or processing errors explicitly disable the engine before reporting fallback.\n- Added regression coverage proving E-AC-3/multichannel metadata alone cannot establish native Dolby output.\n\n## Required device matrix

- iPhone Safari: portrait, landscape, rotation, background/foreground, headphones and Bluetooth route changes.
- iPad Safari: landscape, split view, Stage Manager, rotation, long playback and audio route changes.
- Android Chrome: supported versions, wired/Bluetooth headphones and output route changes.
- Android native adapter (future): Media3 decoder and Spatializer verification.
- Every report records device/OS/browser, tested commit SHA, source codec/track metadata, route evidence, result and logs. Do not store media URLs or tokens in diagnostics.

## Release rules

- Native Dolby output is reported only when a native adapter supplies explicit, traceable output evidence.
- JOC decoding is reported only when the decoder reports successful access-unit processing and object rendering is separately confirmed.
- HRTF is reported as software binaural processing, never as Atmos.
- Unknown layouts bypass processing.
- Any DSP failure returns to the original media route where safe.
- CI, Preview, Chromium emulation and physical-device acceptance are separate gates.
- No merge to main or production deployment is part of this work.
