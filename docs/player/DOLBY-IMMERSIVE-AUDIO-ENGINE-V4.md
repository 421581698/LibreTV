# LibreTV Dolby Immersive Audio Engine 4.0

Status: experimental implementation slice on `feature/dolby-immersive-audio-v4-2026-11-25`.
Base: `feature/cinema-engine-v2-3-integration`.
The branch remains a Draft PR. No merge to main or production deployment is included.

## Scope and non-goals

- Preserve existing ArtPlayer + hls.js / Safari native-HLS ownership.
- Keep native media-element audio as the default and fail-open path.
- Keep software JOC decode/output behind explicit experimental query flags and a user gesture.
- Distinguish metadata hints, platform capability, successful decode, object rendering, and physical output.
- Do not claim Dolby certification, native Dolby decoder output, native Atmos passthrough, authored-object preservation, or 7.1.4 capability.

## Layered architecture

```text
Player / ArtPlayer / existing HLS source ownership
                 |
Audio Capability Inventory
  browser APIs | stream metadata | native adapter facts
                 |
Evidence & Policy Gate
  source generation | CORS | supported profile | user gesture
       |                  |                 |
Native media audio   Existing HRTF       Experimental OpenJOC
(default/fallback)   opt-in path         Worker / WASM
       |                  |                 |
                 Output Verification
  native output evidence | JOC decode evidence | PCM route state
  binaural configured state | fallback reason | diagnostics
```

## Implemented in this branch

- Typed browser audio feature inventory and evidence-based output classification. API presence and HLS metadata are not treated as proof of decode or output.
- PlayerShell capability and verification labels integrated into the existing player UI.
- Fail-open handling for missing/unsupported HLS metadata, source changes, spatial-engine errors, and stale state.
- Version-1 native bridge snapshot validation with strict schema/range/enum checks, playback-session binding, freshness checks, and unknown-field stripping.
- Isolated iOS Swift and Android Kotlin adapter libraries. They report only platform facts exposed to their host; active Dolby output, active JOC decode, and object rendering remain unknown without direct evidence.
- Pinned OpenJOC v0.20.2 WASM build, upstream license retention, reproducible build manifest, dependency tree and SHA-256 evidence.
- Dedicated decoder Worker, bounded input/memory, PCM copying, timestamped transport and decoder evidence.
- Read-only hls.js fragment observation, CMAF sample extraction, `dec3` parsing and CMAF-JOC profile admission.
- In-band I0 BSI validation and D0 `chanmap` / `dec3 chan_loc` consistency checks.
- Bounded 48 kHz stereo AudioWorklet queue, video-clock alignment, user-gesture activation and safe fallback to native media audio.
- Existing opt-in HRTF path remains separate from JOC decode and is never labeled Atmos.

## Validation evidence on current PR head

The current PR head has passing checks for:
- pinned OpenJOC WASM build and upstream decoder bridge tests;
- FFmpeg fragmented-MP4 remux and CMAF extraction → OpenJOC WASM → PCM integration;
- TypeScript, full repository tests, lint and reproducible decoder build-evidence upload;
- general verification and production build;
- web/resource and collector verification;
- iOS Swift adapter tests, Android adapter build/unit tests, and pinned OpenJOC candidate tests/WASM builds.

The upstream CMAF regression fixture provides seven I0-only samples, seven decoded access units, and 1568 stereo PCM frames. The deterministic PCM regression hash is `7e8dc2f9a3671fc9e14e5c9ead03c7d88dcd5ee51fa9ab99f27f58b00b0a8318`. This is a regression baseline, not an independently authored reference master. Synthetic I0+D0 extraction and channel metadata binding are tested, but genuine I0+D0 media decoding is not yet proven.

## Capability boundaries and remaining acceptance

| Area | Current state | Remaining acceptance |
|---|---|---|
| Browser software decode | Experimental OpenJOC WASM Worker | Authorized production media and independent PCM reference |
| D0 dependent substream | Synthetic extraction and metadata binding | Genuine I0+D0 decode and PCM comparison |
| HLS synchronization | PTS mapping anchored to hls.js `frag.start` | Real-media seek/preroll/discontinuity and A/V drift |
| Safari native HLS | Existing native playback remains default | Fragment tap is unavailable on native-HLS path |
| Native iOS/Android | Isolated adapter libraries | Complete trusted host/player integration and physical-device tests |
| Native Dolby/Atmos | Unknown unless independently evidenced | Licensed native decoder/renderer and route/output evidence |
| Performance | Bounded queues and memory guards | CPU, memory, latency, thermal and long-play tests |

The browser software output is stereo PCM. OpenJOC software decode is not a licensed Dolby decoder, native Atmos renderer, native bitstream passthrough, or Dolby certification. CI and physical-device acceptance are separate. The Cloudflare Workers Build check remains a separate failed external check; the isolated Cinema V2.3 Preview workflow is skipped, and no deployment is claimed.

## Release rules

- Native Dolby output requires explicit traceable native-adapter output evidence.
- JOC decode requires successful decoder access-unit evidence for the active source generation.
- Object rendering must be separately evidenced; JOC decoding alone is not object rendering.
- HRTF is reported as software binaural processing, never Atmos.
- Unknown or unsupported layouts bypass processing.
- Any software-DSP failure restores the original media audio route where safe.
- No merge or production deployment is part of this work.
