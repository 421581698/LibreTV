# Cinema Engine V2.3 Integration Tracker

Status: implementation in progress; no production integration is claimed.
Branch: `feature/cinema-engine-v2-3-integration`
Base: `feature/cinema-engine-v2-3-architecture` at `99cad81c1a3505012e53dd898de68d001ba04c81`

## Verified progress — 2026-11-21

Current validated head: `f75687f54307c11f907b410f8dd3a981ede04584`

- **CI green on this exact head:** TypeScript, ESLint, unit tests, production build, web verification and collector verification.
- **PlayerShell observer bridge implemented:** the new controller observes the existing ArtPlayer video element and publishes URL-redacted snapshots. It does not assign `src`, call `load()`, create another video element, or create a second MSE pipeline. ArtPlayer/hls.js remain playback owners.
- **fMP4 metadata foundation implemented:** initialization parsing reads track IDs, media timescales, handler types, sample-entry identifiers (selected by the `trex` description index) and `trex` defaults. Fragment parsing reads `moof/traf/tfhd/tfdt/trun`, applies `tfhd`/ `trex` sample defaults, resolves multi-`traf` implicit data offsets, preserves DTS/PTS ticks and exposes sample byte ranges.
- **Sample extraction implemented:** bounded zero-copy `Uint8Array` sample views with null/range checks.
- **A/V timing foundation implemented:** timescale conversion, presentation-time calculation, timestamp alignment and timeline discontinuity classification.

These are parser/observation foundations, not a complete codec demuxer/decoder or a production playback-engine handoff. Playback commands are not yet owned by the new controller. ASS/SSA rendering, subtitle controls/persistence, spatial audio and physical device acceptance remain open.


## Safety boundaries

- Keep `main` and Production unchanged.
- Keep the existing ArtPlayer + hls.js PlayerShell path available until parity and device acceptance pass.
- Do not merge stacked PRs as part of this work.
- CI, Preview, browser playback and physical-device acceptance are separate evidence gates.
- Never report a metric as decoded/presented unless the browser/backend actually reports it.

## Work packages and exit criteria

### I0 — Baseline and integration seam (P0)
- [ ] Re-read current PlayerShell lifecycle, callbacks, source-switch behavior, fullscreen handling and quality controls.
- [ ] Define a feature-flagged runtime adapter that does not create duplicate media elements.
- [ ] Preserve PlayerSkipApi, Friday player commands, progress persistence, next-episode, ad filtering and source fallback behavior.
- [ ] Add contract tests for mount/unmount, source changes, stale callbacks and media-element reuse.

Exit: the new runtime can be selected in an isolated test path; legacy path remains default.

### I1 — PlayerShell integration (P0)
- [ ] Bind controls and UI to PlaybackController snapshots/commands.
- [ ] Keep one media element across source and layout changes whenever safe.
- [ ] Implement native-HLS vs MSE capability negotiation and explicit fallback.
- [ ] Verify quality/audio/subtitle selection capability reporting.
- [ ] Preserve all existing PlayerShell callbacks and player-control API behavior.

Exit: browser smoke tests demonstrate play/pause/seek/source-switch/restore/next-episode on both paths.

### I2 — fMP4 demux and sample model (P0)
- [ ] Select and audit a maintained demux implementation; do not write a codec.
- [ ] Parse init segments and fragmented media boxes; expose track metadata and complete samples.
- [ ] Preserve DTS/PTS, timescale, composition offsets, sample duration, sync-sample flags and byte ranges.
- [ ] Handle init-segment changes, discontinuities, sequence gaps, malformed boxes and cancellation.
- [ ] Add deterministic MP4/fMP4 fixtures and malformed-input tests.

Exit: fixture tests prove sample boundaries and timestamps; no claim of arbitrary codec decode support.

### I3 — Clock and A/V synchronization (P0)
- [ ] Use media presentation time as the authority for browser-native playback.
- [ ] Map demux timestamps to the playback clock without equating wall time and media time.
- [ ] Add discontinuity, seek, preroll and drift tests.
- [ ] Keep external audio processing opt-in and bounded; native audio remains fallback.

Exit: long-playback and seek tests stay within documented sync tolerance.

### I4 — Stall recovery and diagnostics (P0)
- [ ] Distinguish network starvation, decode/render waiting, seek wait and backend failure.
- [ ] Add bounded retry/backoff, source/backend fallback and retry exhaustion behavior.
- [ ] Record first presented frame separately from fragment arrival.
- [ ] Record rebuffer count/duration, buffered-ahead and frame counters with provenance.
- [ ] Keep telemetry bounded and strip URLs, tokens and credentials.

Exit: injected network/decode failures recover or fail with an actionable reason; no infinite retries.

### I5 — ASS/SSA subtitles (P1)
- [ ] Parse script info, styles, events, dialogue, layers, margins, alignment and supported override tags.
- [ ] Render through an isolated subtitle layer with explicit unsupported-tag behavior.
- [ ] Normalize subtitle timestamps against the playback clock and discontinuities.
- [ ] Add fixture tests for UTF-8/BOM, multiline dialogue, positioning, styling and malformed input.

Exit: representative ASS/SSA fixtures render correctly in desktop and mobile browser tests.

### I6 — Subtitle controls and persistence (P1)
- [ ] Add track selection, off state, delay/offset, size, color, background and safe-area placement.
- [ ] Persist preferences by user/device settings without storing media URLs or credentials.
- [ ] Restore settings after episode/source change and rotation.
- [ ] Respect reduced-motion, accessibility and touch target requirements.

Exit: controls work, persist and restore across reload/rotation/source change.

### I7 — Spatial audio integration (P1; PR #106)
- [ ] Integrate only behind explicit opt-in and verified capability/CORS checks.
- [ ] Preserve native media audio as the default and immediate bypass path.
- [ ] Verify stereo virtualization and verified multichannel routing separately.
- [ ] Do not claim Atmos/object decoding from a `6/JOC` metadata hint.
- [ ] Audit OpenJOC license, reproducible WASM artifacts, input framing and iPad performance before adding any binary/dependency.

Exit: automated routing/teardown tests and physical headphone/device listening evidence.

### I8 — Responsive device acceptance (P0 gate)
- [ ] iPhone Safari portrait and landscape; rotation must not reload or reset playback.
- [ ] iPad Safari landscape and split view; resize by container dimensions, not device model.
- [ ] Fullscreen, safe areas, edge gestures, controls and subtitles tested in each layout.
- [ ] Background/foreground, long playback, memory cleanup and thermal behavior checked.
- [ ] Record device model, iOS/iPadOS version, browser version, Preview SHA and test evidence.

Exit: physical iPhone and iPad acceptance recorded separately from CI and browser automation.

## Required validation sequence

1. TypeScript, ESLint, unit tests and production build.
2. Runtime/backend contract tests and deterministic fMP4/subtitle fixtures.
3. Chromium and desktop Safari browser smoke tests.
4. Isolated Preview deployment whose running SHA matches the tested commit.
5. Physical iPhone Safari and iPad Safari landscape/split-view acceptance.
6. Only after all gates: request explicit merge/deployment authorization.

## Dependency notes

- PR #108 currently provides runtime foundations, not PlayerShell integration.
- PR #105 provides existing PlayerShell diagnostics/stability baseline.
- PR #106 provides a separate spatial-audio foundation, not a live PlayerShell feature.
- PR #107 provides playback lifecycle contracts.
- This tracker does not claim any unchecked item is implemented or accepted.
