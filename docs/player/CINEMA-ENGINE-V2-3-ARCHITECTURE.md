# LibreTV Cinema Engine V2.3 — Architecture & Implementation Plan

Status: architecture baseline / implementation branch  
Branch: `feature/cinema-engine-v2-3-architecture`  
Base: `feature/libretv-native-player-v1` (PR #107 stack)  
Production: unchanged; `main` unchanged.

## 1. Mission and ownership

Build a LibreTV-owned playback runtime and cinema experience without writing codecs or replacing proven browser media primitives.

LibreTV owns:
- playback sessions, command serialization, state transitions and event ordering;
- source normalization, capability negotiation, backend selection and recovery;
- stream inspection, rendition policy, buffer/stall diagnostics and source fallback;
- audio/subtitle track policy, optional processing, UI and responsive layouts;
- privacy-bounded telemetry, deterministic tests and device acceptance evidence.

The platform owns hardware decode/presentation, codec availability, OS-level media routing and protected-media implementation. Do not bypass DRM or claim unsupported codec capabilities.

## 2. Layered architecture

```text
Cinema Experience Layer
  React controls / Liquid Glass / touch / keyboard / accessibility
                    |
Playback Runtime
  Session Manager / Controller / Command Queue / Event Bus
  Multi-axis State / Playback Clock / Lifecycle Registry
                    |
Capability & Backend Layer
  Source Inspector / Capability Negotiator / Backend Registry
       | Native HTMLMedia | HLS-MSE (hls.js) | experimental backends
                    |
Media Pipeline
  Stream Engine | Video Engine | Audio Engine | Subtitle Engine
                    |
Platform Adapter
  HTMLMediaElement / MSE / Safari native HLS / AudioContext /
  AudioWorklet / GPU / browser codec capability
```

Cross-cutting services: Diagnostics, Privacy, Recovery, Feature Flags, Event Audit, Test Fixtures and Performance Budgets.

## 3. P0 runtime contracts

### 3.1 Playback session identity

Every load creates a new immutable session identity:
- `sessionId`: unique identity for the logical playback session;
- `generation`: monotonically increasing source generation;
- `eventSequence`: ordered event sequence within the generation.

Every backend callback, async result, timer-like scheduled callback and worker message must carry the identity it belongs to. Ignore stale generations and out-of-order events. A source switch invalidates old work before attaching the new source.

Use AbortController for cancellable fetch/inspection work. Teardown must be idempotent and release listeners, object URLs, workers, audio nodes and backend resources. Keep a single media element where safe; replace it only when platform/CORS constraints require it.

### 3.2 Backend contract

The controller talks to a typed backend contract, never directly to hls.js or a UI component. Required operations:
- attach / load / play / pause / seek;
- setVolume / setMuted / setPlaybackRate;
- selectAudioTrack / selectTextTrack / selectQuality where supported;
- getCapabilities / getSnapshot / dispose.

Backend events are normalized into runtime events. Capability differences must be explicit; unsupported operations return typed results, not silent no-ops.

### 3.3 Multi-axis state

Do not overload one `phase` field. Maintain independent axes:
- playback: idle, loading, ready, playing, paused, ended, error, disposed;
- network: idle, fetching, stalled, offline;
- decode: unknown, decoding, waiting, failed;
- seek: idle, seeking, settled;
- audio: native, processing, bypassed, failed;
- fullscreen: inline, fullscreen, picture-in-picture.

State transitions remain deterministic and reducer-testable. Impossible combinations are validated at the controller boundary.

### 3.4 Playback clock

One session clock is the time authority for UI, subtitle synchronization, audio synchronization and progress persistence. Prefer media presentation time for browser-native playback. External PCM pipelines must expose their own clock mapping and bounded drift correction; never assume wall-clock time equals media time.

## 4. Media engines

### 4.1 Stream Engine
- inspect HLS manifests, variants, audio groups, subtitle groups and codecs;
- support native HLS and MSE/hls.js as separate backend strategies;
- isolate fMP4 demux/sample extraction from UI and audio DSP;
- preserve timestamps, discontinuities, init segments and segment boundaries;
- do not assume hls.js metadata alone provides complete compressed audio access units.

### 4.2 Video Engine
- preserve browser hardware decode as the default;
- retain PR #105 first-frame, buffer, rebuffer and dropped-frame diagnostics;
- conservative Auto-only quality guard; never silently override a manual quality selection;
- recovery distinguishes network starvation, decode stalls and backend failures;
- HDR and codec labels are capability hints unless actual output evidence is available;
- enhancement pipeline (sharpen, denoise, color, experimental super-resolution) is optional, isolated and budgeted. It must fail open to normal playback.

WebCodecs is an experimental low-level decode API, not an HLS loader, demuxer, DRM implementation or universal replacement for MSE. Do not make it the default Safari path.

### 4.3 Audio Engine
- native media-element audio remains the safe default;
- inspect audio codec, channel layout and track metadata without overstating certainty;
- optional Web Audio routing is gated by CORS safety, user gesture and verified source layout;
- unknown layout or unsupported processing bypasses to native audio;
- spatial headphone virtualization must not be labelled as Atmos;
- preserve original audio path and provide immediate fallback if processing fails.

### 4.4 OpenJOC integration (experimental adapter)
OpenJOC's Rust/WASM decoder and binaural renderer are the first candidate for E-AC-3 JOC decoding reuse, subject to a separate license and technical audit.

LibreTV owns:
- extracting complete supported compressed access units from the stream/container;
- PTS mapping, discontinuity/preroll handling and A/V synchronization;
- bounded PCM queues, AudioWorklet output, underrun handling and teardown;
- feature gating and fallback to native audio.

Do not add the dependency or ship WASM until verifying upstream commit, Apache-2.0 obligations, bundled HRTF/data notices, third-party licenses, WASM build reproducibility, supported input framing and iPad Safari real-time performance. A playlist `6/JOC` marker is only a metadata hint; it is not proof of Atmos object decoding. Do not claim Dolby certification or use Dolby marks as a product claim.

Cavern is algorithm/reference research only unless its license terms are separately resolved for the intended distribution. FFmpeg reuse requires component/build-configuration license review. KSPlayer is an Apple-native architecture reference, not a browser module.

### 4.5 Subtitle Engine
Independent track model for WebVTT, SRT and supported ASS/SSA rendering. Own parsing, timestamp normalization, offset, style, language selection and synchronization. Unsupported formats degrade clearly; do not silently display malformed cues.

## 5. Experience and responsive layout

One Playback Session and media element are retained across layout changes whenever platform constraints allow.

- iPhone landscape: immersive video, minimal controls, safe-area-aware gestures and conflict-aware edge navigation.
- iPad landscape: cinema canvas plus optional episode/resource sidebar; expanded mode when desired.
- iPad split view: use container dimensions (ResizeObserver), not device model assumptions.
- Desktop: persistent optional playlist/track/settings side panels.
- Portrait layouts remain usable; rotation must not reload the source or reset time, tracks, quality or subtitles.
- Liquid Glass is a presentation system only. Video surfaces avoid expensive live backdrop effects; reduced-motion and low-performance modes are required.

## 6. Diagnostics, privacy and evidence

Collect bounded, URL/token-free diagnostics:
- time to first presented frame (not fragment arrival);
- rebuffer count/total/max duration and buffered-ahead;
- decoded dimensions, presented/dropped frame counters when available;
- selected rendition, source/backend class and recovery outcome;
- audio route/processing mode and subtitle format;
- session lifecycle and resource cleanup outcome.

Every metric records provenance: browser-reported, backend-reported, inferred or unavailable. Never label manifest resolution as decoded resolution. Do not store full media URLs, tokens, credentials or personal media history in telemetry.

## 7. Migration and compatibility

- Keep existing PlayerShell (ArtPlayer + hls.js) as compatibility/fallback path.
- PR #105 stability/diagnostics work remains baseline.
- PR #106 spatial-audio foundation remains a separate integration dependency until the new media-element lifecycle and CORS constraints are covered.
- PR #107 is the current runtime-contract foundation; this branch stacks on it. Do not retarget or merge PRs as part of this architecture change.
- No production entry-point replacement until parity and device acceptance gates pass.

## 8. Implementation sequence

1. **N1 Session Runtime (P0):** identity/generation, event ordering, command queue, lifecycle registry, reducer hardening and tests.
2. **N2 Backend Contract (P0):** typed capabilities/results/events; fake backend; native HTMLMediaElement backend for direct files and supported native HLS.
3. **N3 HLS/MSE Adapter (P0):** encapsulate hls.js; preserve diagnostics, quality guard, recovery and Safari native-HLS negotiation.
4. **N4 Stream/Track Model (P1):** manifest inspection, audio/subtitle track contracts, timestamp and discontinuity model.
5. **N5 Cinema UI (P1):** responsive iPhone/iPad/desktop surfaces bound only to PlaybackController.
6. **N6 Audio (P1):** integrate existing spatial foundation behind opt-in and safe bypass; OpenJOC WASM spike stays isolated.
7. **N7 Video enhancement (P2):** isolated enhancement experiments with strict frame-time, memory and thermal budgets.
8. **N8 Acceptance (P0 gate):** CI, isolated Preview, browser matrix and physical iPhone/iPad Safari acceptance recorded separately.

## 9. Acceptance gates

### Automated
- TypeScript, ESLint, unit tests and production build;
- reducer/session identity and stale-event race tests;
- backend contract and fake-media tests;
- MP4/fMP4/HLS fixtures, seek/source-switch/discontinuity/recovery tests;
- audio CORS/bypass/teardown and subtitle sync tests;
- bounded telemetry and no-URL/token regression tests.

### Browser and device
- Chromium desktop and Safari desktop where available;
- physical iPhone Safari and iPad Safari portrait/landscape;
- iPad split-view resizing, fullscreen behavior, source switching and background/foreground;
- long playback, memory/resource cleanup and thermal/performance checks.

CI success is not physical-device acceptance. Preview success is not production acceptance. No merge to `main` and no production deployment without explicit authorization and all required gates.

## 10. Explicit non-goals

- writing video/audio codecs from scratch;
- replacing browser hardware decode with a custom software pipeline by default;
- treating WebCodecs as a complete streaming player;
- claiming Atmos support from channel labels or HLS metadata;
- forcing all media through Web Audio;
- deleting ArtPlayer/hls.js before parity is demonstrated;
- merging, deploying production or changing `main` in this phase.
