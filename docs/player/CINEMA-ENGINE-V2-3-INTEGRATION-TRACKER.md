# Cinema Engine V2.3 Integration Tracker

Status: implementation in progress; no production integration is claimed.
Branch: `feature/cinema-engine-v2-3-integration`
Base: `feature/cinema-engine-v2-3-architecture` at `99cad81c1a3505012e53dd898de68d001ba04c81`
CI-validated code head: `f5951fb181ca02987c143bda029c1504015cf40f`

## Current validation

- Exact code head `f5951fb181ca02987c143bda029c1504015cf40f` passed TypeScript, ESLint, unit tests and production build in both prelaunch-checks and Resource Playback Verification. Collector verification also passed.
- The following documentation commit carries the explicit preview marker; the isolated Preview workflow will rerun its own typecheck, lint, tests, asset preparation and build before deployment.
- PR #110 remains Draft. No merge, main update or production deploy has been performed.
- A dedicated Cloudflare Worker preview config and gated deploy workflow are prepared. This tracker update triggers the workflow with `[cinema-v2.3-preview]`; deployment and browser smoke checks are pending.
- Netlify Production remains on its existing main deployment.
- Chromium mobile viewport emulation is included in the Preview workflow; it is not physical iPhone/iPad Safari acceptance.

## Implemented foundations

### Playback control handoff

- ArtPlayer's play/pause/currentTime/seek command surface is bridged to the existing PlaybackController.
- The controller uses the existing ArtPlayer video element; it does not assign a second source, call a second load path, create a second video element or create a second MSE/HLS pipeline.
- If the controller is unavailable or a command fails, the original ArtPlayer method/setter is invoked.
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
