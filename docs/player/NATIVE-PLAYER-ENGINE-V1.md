# LibreTV Native Player Engine V1.0

## Mission

Build a LibreTV-owned playback system: lifecycle, orchestration, UI contract, quality policy, recovery, telemetry, track selection, and audio routing belong to LibreTV. Browser codecs, hardware decoding, and standardized media APIs remain platform capabilities.

This is an incremental replacement, not a big-bang rewrite. Existing playback stays available until the new path passes the same or stronger acceptance gates.

## Baseline and constraints

- The current PlayerShell uses ArtPlayer for player UI/control integration and hls.js for HLS/MSE streaming.
- PR #105 contributes playback diagnostics and conservative adaptive-quality protection. Preserve these capabilities and their evidence semantics.
- PR #106 contributes CORS-aware spatial-audio inspection/routing. Keep it isolated until media-element lifecycle and source-origin behavior are handled by the new backend contract.
- Do not claim browser-level WebCodecs support means universal HLS playback. WebCodecs is a low-level decode path, not an HLS demuxer, manifest loader, DRM stack, or drop-in replacement for MSE.
- iOS/iPadOS Safari may require native HLS through HTMLMediaElement; desktop Chromium/Firefox may use MSE/HLS adapters. Backend selection must be capability- and source-aware.
- No DRM circumvention, access-control bypass, or unsupported codec promises.

## Ownership boundary

LibreTV owns:
1. Playback state machine and command serialization.
2. Media source normalization and backend selection.
3. HLS manifest/rendition inspection and adaptive quality policy.
4. Buffer health, stall classification, retry/recovery and source fallback.
5. Track metadata, subtitles, audio selection and spatial-audio policy.
6. Player controls, keyboard/touch/remote interaction and responsive fullscreen behavior.
7. Privacy-bounded diagnostics and reproducible playback tests.

The browser/platform owns:
- Hardware video/audio decode and presentation.
- OS-level fullscreen/Picture-in-Picture integration where required.
- Codec availability, protected media implementation, and device output routing.

## Layered architecture

```
Player UI (React, accessible controls, touch/keyboard/remote)
        |
Playback Controller (commands, state machine, event ordering)
        |
Backend Registry / Capability Negotiator
        |
+----------------------+------------------------+
| Native HTMLMedia     | MSE / HLS Adapter      |
| Safari/native HLS    | hls.js initially       |
+----------------------+------------------------+
        |
HTMLMediaElement / MSE / browser decoder / GPU
        |
Audio Graph (opt-in, CORS-safe) + Diagnostics
```

A future WebCodecs backend is an experimental option only after a real demuxing/packaging strategy and device coverage exist. It must not be the default Safari path.

## Migration sequence

### N1 — Engine contracts and deterministic state machine
- Define source, backend, snapshot, event and command contracts.
- Make state transitions pure and unit-testable.
- No change to the production player entry point.

### N2 — Native media backend
- Implement an HTMLMediaElement backend for direct MP4/WebM and native HLS where supported.
- Own event mapping, source lifecycle, seek, rate, volume, fullscreen capability reporting and teardown.
- Add fake-media tests and browser smoke tests.

### N3 — HLS/MSE adapter
- Put hls.js behind the backend interface; do not let React UI call hls.js directly.
- Preserve level metadata, buffer diagnostics, recovery and quality guard.
- Keep native HLS fallback for Safari where appropriate.

### N4 — LibreTV UI
- Build the control surface against PlaybackController only.
- Preserve existing parent callbacks, watch progress, episode switching, skip marks, Friday commands and playback confirmation contracts.

### N5 — Audio and spatial sound
- Integrate PR #106 inspector/engine behind an explicit user gesture.
- Gate on verified track metadata and CORS safety; bypass safely on unknown layouts or unsupported sources.
- Validate source switching on the same and replaced media elements.

### N6 — Shadow comparison and rollout
- Run old and new paths against the same fixture matrix in isolated Preview.
- Compare startup-to-first-frame, stalls, decoded dimensions, dropped frames, seeking, source switching and memory/lifecycle leaks.
- Enable per-preview only after acceptance; never silently replace the production path.

## Acceptance gates

- Unit: state transitions, command ordering, source validation, retry budgets, ABR decisions, event teardown.
- Browser: MP4, fMP4, HLS VOD/live where supported, seeking, rendition changes, source changes, network interruption/recovery.
- Devices: iPad Safari portrait/landscape/fullscreen; iPhone Safari; desktop Chromium and Safari.
- Media evidence: actual decoded dimensions and presented-frame evidence, not manifest labels or synthetic screenshots.
- Audio: original route remains default; headphone spatial mode is opt-in and never allowed to turn a working source silent.
- CI green, isolated Preview verified, physical-device acceptance recorded separately.

## Non-goals for V1

- Writing a video codec or hardware decoder from scratch.
- Reimplementing DRM or bypassing protected-media restrictions.
- Promising Dolby Atmos object decoding from an HLS JOC marker.
- Removing hls.js before an equivalent HLS path is proven.
- Merging to main or deploying production as part of the initial foundation.
