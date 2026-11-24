> **Superseded for current product scope (2026-11-24):** The independent generic spatial-session lifecycle described here has been removed. Keep this file as historical test specification only; Dolby-only acceptance is defined in [DOLBY-ONLY-ARCHITECTURE-RESET.md](./DOLBY-ONLY-ARCHITECTURE-RESET.md).

# P3 Lifecycle Test Matrix

- Status: Isolated MP4/WebM and HLS controller paths implemented; HLS track-selection/teardown and active fatal-error fallback unit coverage added; browser resource-CORS matrix added; full 20-case matrix and real-device acceptance pending
- Date: 2026-11-24
- Related decision: [P3 Architecture Decision Record](./P3-ARCHITECTURE-DECISION.md)
- Branch: `feature/libretv-ipad-edition-product` (PR #99 remains Draft)

## Evidence labels

Each test result must use four separate evidence fields:

- **Implemented** — code path exists and is reviewed.
- **Automated** — repeatable test passes in CI, with test name and run URL.
- **Preview** — exact-head isolated iPad Preview audit passes, with artifact/report reference.
- **Real device** — named physical device, OS/browser version, source fixture, output chain, and observed result are recorded.

Allowed values: `Not started`, `In progress`, `Pass`, `Fail`, `Blocked`, `Not applicable`. A pass in one evidence field never implies a pass in another.

## Initial implementation evidence (not full acceptance)

Code added on the current P3 implementation line:

- `src/lib/spatial-media-session.ts`: independent direct MP4/WebM/HLS media element, CORS probe, CORS-before-src ordering, explicit gesture activation, play/pause/seek/rate/volume synchronization, isolated HLS controller ownership, track selection, fatal-error fallback, native-element restoration, selected-track restoration on teardown, and idempotent disposal.
- `src/components/player-shell.tsx`: opt-in two-step prepare/activate control; independent hls.js/MSE controller or separate Safari native-HLS controller; spatial-session audio-track selection; source-change and unmount teardown; generation guard against stale asynchronous preparation.
- `src/lib/spatial-media-session.test.ts`: unit coverage for HLS adapter requirement, isolated HLS controller startup, distinct element/CORS ordering, independent audio-track switching, controller teardown, direct-media CORS failure, explicit activation, pause/resume and state synchronization, native mute fallback, media error fallback, activation rejection, selected-track restoration on teardown, idempotent disposal, and disposal while activation is pending.
- `src/lib/spatial-audio.test.ts`: unknown input layout remains on bypass.

The controller now supports direct MP4/WebM plus an isolated HLS path. A new browser CORS matrix checks independent readability of master manifest, variant playlist, segment, AES-128 key and cross-origin redirect, plus fail-closed behavior for a resource without CORS headers; this is not a media decode/playback fixture and does not prove hls.js fallback continuity. When hls.js is available, the spatial session owns a separate hls.js instance and media element; on Safari without hls.js/MSE support, it owns a separate native-HLS media element and uses the platform audioTracks list when exposed. The original ArtPlayer/HLS element remains untouched and is the fallback. Manifest and Safari metadata startup are time-bounded; fatal pipeline errors dispose the isolated session. Audio-track selection is scoped to the isolated session. The session currently enables stereo HRTF only when the selected track explicitly declares two channels; unknown layouts and six-channel declarations remain bypassed. Live track changes update the engine input route. Unit tests validate the adapter contract, declared-channel routing and track selection, but do not replace a real hls.js integration test with controlled cross-origin manifest, playlist, segment, key and redirect fixtures. Exact-head iPad Verify, Resource Playback Verification, HLS Browser Playback Smoke and HLS External Stream Smoke all passed on `3a607107a16d21320231877a281df48345fcef4e` (runs `45378508106`, `45378507893`, `45378507613`, `45378507620`). These software gates do not establish Preview acceptance, Safari/iOS behavior, or physical output.

## Required test matrix

| ID | Scenario | Expected behavior / assertions | Automated evidence | Preview / device evidence |
|---|---|---|---|---|
| P3-01 | Create session from explicit user gesture | Session creates isolated media element; AudioContext is created/resumed only from the gesture path; native `art.video` is never captured | Unit test for state transition and element identity; browser test for activation | iPad Preview control/state check; real Safari gesture check |
| P3-02 | Cancel/deny user activation | Spatial session remains inactive; native playback remains audible and usable; UI reports unavailable/fallback | Mock rejected `AudioContext.resume()` and browser autoplay-policy test | Preview fallback state; real Safari/iOS check |
| P3-03 | CORS success for direct MP4/WebM | CORS mode is set before `src`; valid response allows isolated capture; native element remains untouched | Request/element-order unit test and browser integration test | Preview with controlled CORS fixture; device check where supported |
| P3-04 | CORS failure / opaque response / redirect failure | Spatial path aborts; no capture of native element; native playback remains available | Simulated CORS failure and browser network test | Preview fallback reason; device/network evidence |
| P3-05 | hls.js MSE source | Isolated session owns a separate hls.js instance and media element; fatal errors trigger fallback; manifest/playlist/segment/key CORS still needs controlled-fixture verification | Controller unit tests include fatal fallback after activation; browser CORS matrix covers master/variant/segment/key/redirect and deny case; full hls.js playback fixture still pending | Exact-head Chromium Preview; Safari native HLS is a separate path |
| P3-06 | Safari native HLS regression | Existing Safari native-HLS route remains unchanged and is not intercepted by spatial session | Guard/regression tests proving native route is selected and `art.video` is not captured | Real iPhone/iPad Safari playback and audio check required |
| P3-07 | Change episode while spatial session active | Old session token invalidates pending work; old session is disposed once; new source cannot receive stale events | Race-condition tests with delayed manifest/metadata promises | Preview rapid episode-switch test; real-device spot check |
| P3-08 | Reuse ArtPlayer video across episodes/providers | ArtPlayer continues reusing its native element; each spatial session uses a distinct owned element; no duplicate source-node binding | Element identity and repeated create/dispose tests | Preview multi-episode flow |
| P3-09 | Switch provider/source | New source is prepared independently; failed preparation returns to native route; no silent audio loss | State-machine and browser source-switch tests | Preview with same-origin and CORS-controlled sources |
| P3-10 | Switch audio track | Selection is routed to the independent spatial HLS controller; unsupported/missing tracks must not mutate the original HLS instance | Isolated controller track-selection unit test added; end-to-end identity/race tests pending | Preview multi-track fixture; real device only with known test media |
| P3-11 | Pause/resume | Native and spatial session state remains coherent; AudioContext suspension/resumption is handled without duplicate graph connections | Lifecycle tests for paused/playing and context state | Preview pause/resume; Safari device check |
| P3-12 | Seek/time synchronization | Position transfer is bounded and deterministic; unsupported seek transfer causes explicit fallback | Fake-timer-free deterministic media event tests and browser seek test | Preview seek during transition |
| P3-13 | Volume/mute/rate controls | User settings remain coherent across native/spatial transitions | Controller contract tests | Preview control interaction |
| P3-14 | Media/manifest/segment/decoder error | Error enters recovery once; no unhandled rejection or stale callback; native route is restored | Injected error tests for each layer | Preview error fixture; device test where reproducible |
| P3-15 | AudioContext failure/interruption | Rejected, interrupted, or closed context leads to controlled fallback; no attempt to reuse a captured native element | Mock context lifecycle tests and browser test | Preview failure state; real iOS interruption check |
| P3-16 | Teardown/unmount/repeated dispose | Listeners and graph nodes are released; context closes when owned; dispose is idempotent; stale events are ignored | Resource/listener spy tests and repeated teardown test | Preview route navigation/unmount |
| P3-17 | Native fallback after active spatial playback | Spatial element is disposed; source/track/time/state are restored on untouched native ArtPlayer route where supported | Browser end-to-end fallback test | Preview fallback flow; real Safari/iPad audible continuity check |
| P3-18 | Unknown channel layout | No 5.1/7.1 route is inferred from channel count; unsupported layout bypasses channel-specific routing | Metadata/layout negative tests | Preview diagnostics state |
| P3-19 | UI state and claims | UI accurately shows Off/Preparing/Active/Unavailable; never claims Atmos decode, object rendering, or passthrough from metadata | Component tests and accessibility/state assertions | Preview light/dark and narrow/wide viewport audit |
| P3-20 | Existing playback regression | ArtPlayer, hls.js, direct MP4/WebM and Safari native HLS baseline behaviors remain intact | Existing playback suite plus new regression suite | Exact-head Preview; real browser/device matrix |

## Cross-cutting invariants

1. The spatial engine never calls `createMediaElementSource()` with the existing `art.video`.
2. A media element receives at most one `MediaElementAudioSourceNode` for its lifetime.
3. CORS configuration precedes source assignment; a failed check always falls back.
4. AudioContext activation is tied to an explicit user gesture.
5. Session generation tokens prevent stale async work from mutating the current player.
6. Session disposal is idempotent and does not leave listeners, active sources, or graph nodes behind.
7. Safari native HLS remains the untouched default route until a separate real-device-verified design explicitly supports otherwise.
8. Unknown channel layouts bypass layout-specific processing.
9. UI and diagnostics distinguish metadata detection, browser decode, Web Audio processing, physical output, Atmos object rendering, and bitstream passthrough.
10. No CI/Preview simulation is reported as physical-device evidence.

## Exit criteria

P3 may be marked **implemented** only when the isolated session controller, UI, source/track transitions, and native fallback exist.

P3 may be marked **automated** only when every applicable automated row above passes in CI on the exact head SHA.

P3 may be marked **Preview accepted** only when the exact-head Preview run and visual/interaction artifacts pass.

P3 may be marked **real-device accepted** only when the named iPhone/iPad and Safari/iOS results are recorded. In particular, Safari native HLS regression and audible native fallback cannot be inferred from Chromium.

Until all required evidence is present, P3 overall status remains **not finally accepted**.
