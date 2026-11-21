# Cinema Engine V2.3 Integration Tracker

Status: implementation in progress; no production integration is claimed.
Branch: `feature/cinema-engine-v2-3-integration`
Base: `feature/cinema-engine-v2-3-architecture` at `99cad81c1a3505012e53dd898de68d001ba04c81`
Latest code head awaiting exact-head CI: `c69acde915627d5297374181a7bc7b751ac8989a`

## Current validation

- Exact code head `c8840875cbfc7175994deb8d87cc3485ce8024a8` passed TypeScript, ESLint, unit tests and production build in both prelaunch-checks (run `44897430572`) and Resource Playback Verification (run `44897430542`). Collector verification also passed.
- The following documentation commit carries the explicit preview marker; the isolated Preview workflow will rerun its own typecheck, lint, tests, asset preparation and build before deployment.
- PR #110 remains Draft. No merge, main update or production deploy has been performed.
- A dedicated Cloudflare Worker preview config and gated deploy workflow are prepared. This tracker update triggers the workflow with `[cinema-v2.3-preview]`; deployment and browser smoke checks are pending.
- Netlify Production remains on its existing main deployment.
- Chromium mobile viewport emulation is included in the Preview workflow; it is not physical iPhone/iPad Safari acceptance.

## Implemented foundations

### Playback control handoff

- ArtPlayer's play/pause/currentTime/seek command surface is bridged to the existing PlaybackController.
- The controller uses the existing ArtPlayer video element; it does not assign a second source, call a second load path, create a second video element or create a second MSE/HLS pipeline.
- If the controller is unavailable, throws during dispatch, or explicitly reports `unsupported` / `not-ready`, the original media method/setter is used as a compatibility fallback. A definitive controller media failure is surfaced rather than blindly replayed.
- Source ownership remains with the existing ArtPlayer + hls.js path. Preview browser playback is still required to verify the real UI path and legacy parity.

### fMP4 and timeline

- Init parsing: track IDs, mdhd timescales, handler types, sample-entry lists and trex defaults.
- Fragment parsing: moof/traf/tfhd/tfdt/trun; tfhd overrides; trex sample defaults; DTS/PTS composition offsets, duration/size/flags, sync flags and data offsets.
- Multi-traf implicit data offsets and sample-description index selection are covered.
- Sample payload extraction is bounded and zero-copy; parsed payload ranges can be checked against mdat boxes.
- Stateful session handles init-segment replacement, multiple moof fragments, gap/overlap/reset classification and timeline reset after malformed fragments.
- Real upstream fixtures cover mux.js WebVTT init/media, mux.js AVC/AAC init metadata and Shaka Player IAMF audio init/media sample extraction.
- This remains a bounded parser/sample-metadata foundation, not a complete codec demuxer/decoder. Codec configuration records, CENC decryption, sample groups, edit lists, all real-world fragment layouts and arbitrary codec decode are not complete.

### ASS/SSA and subtitle controls

- JASSUB 2.5.38 is installed as the ASS/SSA renderer.
- Worker entry is bundled locally; WASM variants and the default font are self-hosted under `/jassub/` during dev/build.
- Online font lookup is disabled. Third-party license notices are retained.
- PlayerShell accepts local .ass/.ssa files, renders them through JASSUB and tears the renderer down on source change/player close.
- HLS/native track selection, enable/off, native caption font size/background opacity and ASS time offset controls are present.
- Track choice and native caption style preferences persist per source/episode.
- Local ASS/SSA file contents are session-only and are not restored after reload. Embedded-font extraction and full ASS style parity remain unverified.

### Spatial audio

- Spatial audio is opt-in and only attaches after a user gesture.
- HLS audio metadata and CORS safety are checked; unknown channel metadata falls back to original audio.
- Stereo headphone virtualization is available through the existing spatial engine.
- Six-channel input remains bypassed when channel ordering/layout is unknown. This is not Atmos object decoding.
- Physical headphone/device listening and iOS Safari teardown/performance checks remain open.

## Remaining work and gates

1. **CI on exact head:** TypeScript, ESLint, unit tests, production build, web verification and collector verification must all pass on the same head.
2. **Isolated Preview:** trigger the gated Cloudflare Worker workflow only after exact-head CI is green. Expected isolated URL: `https://libretv-cinema-v23-preview.bggdbh.workers.dev`. It must report the tested SHA and pass endpoint plus Playwright PlayerShell/mobile-viewport smoke checks.
3. **Browser acceptance:** verify play/pause/seek, source switching, same video element, HLS/native fallback, subtitle selection, JASSUB worker asset loading, spatial audio opt-in and teardown.
4. **Physical acceptance:** iPhone Safari portrait/landscape/rotation; iPad Safari landscape/rotation/split view/Stage Manager; background/foreground; memory and long-playback. Record device model, OS/Safari version, Preview SHA and evidence.
5. **Full demux roadmap:** audit a maintained full demux implementation, parse codec configuration/sample groups/edit lists and CENC metadata, add additional real video/audio fragment fixtures, and test cancellation/recovery before claiming complete demux.
6. **Persistence follow-up:** add a quota-bounded IndexedDB policy if local ASS/SSA file content must survive reload. Current track/style preferences already persist.

## Acceptance evidence

See [CINEMA-ENGINE-V2-3-DEVICE-ACCEPTANCE.md](./CINEMA-ENGINE-V2-3-DEVICE-ACCEPTANCE.md) for the physical device matrix and test evidence template.

## Safety boundaries

- Keep `main` and Production unchanged.
- Keep the existing ArtPlayer + hls.js source path as the compatibility fallback.
- Do not merge stacked PRs as part of this work.
- CI, Preview, Chromium emulation and physical Safari acceptance are separate evidence gates.
- Never report sample arrival as decoded/presented frames unless the browser/backend reports it.
- No merge or production deployment without explicit authorization after all gates.

## Preview diagnostic update (2026-11-21)

- The first isolated Preview run decoded the 1920×1080 fMP4 fixture and passed pause/resume, custom timeline seek, and control auto-hide/reveal checks.
- The browser smoke then failed with repeated `Maximum call stack size exceeded` errors after the source-switch exercise. The mobile viewport job was skipped as a consequence.
- The smoke runner now captures page-error stacks and console locations, and saves its screenshot before failing so the next run produces actionable artifacts.
- This diagnostic update does not claim the source-switch defect is fixed; rerun the isolated Preview acceptance before proceeding.

## Source-switch regression fix (2026-11-21)

- Preview run `44890134353` decoded the 1080p fMP4 fixture and passed play/pause, timeline seek and control-overlay lifecycle checks, but reported repeated `Maximum call stack size exceeded` during subtitle-track loading.
- The captured stack entered hls.js `onSubtitleTrackLoading`; PlayerShell was refreshing subtitle selection from `SUBTITLE_TRACK_SWITCH`, then assigning `hls.subtitleTrack` again from that refresh. This could re-emit the switch event recursively.
- Commit `3b8c3a1` removes the re-entrant switch-event refresh listener while retaining subtitle-list updates and direct user selection handling.
- Exact-head TypeScript, ESLint, unit tests and production build passed in prelaunch-checks and Resource Playback Verification; collector verification also passed.
- The isolated Preview must now rerun on this exact fix commit. Source-switch regression, mobile viewport emulation, JASSUB rendering and spatial-audio browser behavior remain unverified until that run completes.


## Playback bridge concurrency follow-up (2026-11-21)

- Scoped the asynchronous play-command re-entrancy guard to the synchronous controller dispatch call stack. It no longer remains held while the browser's `HTMLMediaElement.play()` Promise is pending.
- Added a regression test that starts a pending play Promise, issues pause before it settles, and verifies pause still routes through PlaybackController.
- Exact code head `c8840875cbfc7175994deb8d87cc3485ce8024a8` passed both prelaunch-checks and Resource Playback Verification, including TypeScript, ESLint, unit tests and production build; collector verification passed as well.
- The source lifecycle remains deliberately owned by PlayerShell + hls.js. `NativeMediaBackend.observeExistingSource()` attaches to the already active video element without assigning `src`, calling `load()`, or creating a second MSE pipeline. PlaybackController currently owns command routing and observed-session state, not HLS manifest/MSE source orchestration.
- Isolated Preview browser regression must now run against this updated exact branch head; CI success alone does not close the browser acceptance gate.


## Media-source observer lifecycle regression coverage (2026-11-21)

- Added a regression test that observes one media element, switches the same controller to a second element/source, and verifies events from the previous element are detached and ignored.
- Code commit: `c69acde915627d5297374181a7bc7b751ac8989a`.
- The prior bridge concurrency fix at `c8840875cbfc7175994deb8d87cc3485ce8024a8` passed both CI workflows. This additional observer-lifecycle test has not yet received an exact-head CI result.
- The current branch head is marked for a fresh isolated Preview run. Preview browser acceptance remains pending; do not infer a successful deployment from this marker commit.
