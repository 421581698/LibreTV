# LibreTV · FRIDAY SPATIAL OS V4
## P2 — Content-first Cinematic Home Integration Log

**Branch:** `feature/friday-spatial-os-v4`  
**Scope:** Integrate the V4 shell into the existing homepage without replacing movie, recommendation, search, or Friday runtime services.

## Implemented on the feature branch

- Mounted `SpatialAppShell` around the V2 homepage and connected the four canonical space selections to local view state (no route push or page reload).
- Reused the existing `Header` for search, live, theme, history, download and settings actions.
- Added `SpatialFridayEntry`, a 44px compact entry that listens to existing Friday voice/audio events and dispatches the existing `friday-home-orb-toggle` event. It does not create or own ASR/TTS/VAD lifecycle.
- Removed the oversized V2 homepage hero orb from the V4 cinematic content path. The compact Friday entry is now in the shell header, so the real recommendation content can lead the page.
- Preserved `HomeRecommendationSection` and its existing Douban, Bangumi and hot-list adapters; no placeholder posters or replacement data were introduced.
- Preserved the existing movie search, result streaming, source health, recommendation click-to-detail and `DetailModal` flows.
- Added explicit placeholder states for Intelligence, Resource Universe and Identity. These destinations are not represented as implemented workspaces before their migration stages.
- Added V4-specific content-first layout overrides, including iPhone bottom navigation safe-area spacing and reduced-motion behavior.
- Corrected the compact Friday button's accessibility semantics: it reports the listening toggle state rather than claiming to open a dialog.

## Compatibility boundaries

- Existing `AIFloatingBall` remains mounted in its current inline runtime mode to own the Friday voice controller and listen for the existing homepage orb event. The duplicate visible floating entry remains disabled on the V2 homepage.
- FridayOrb remains the existing Canvas renderer. No voice controller, speech engine, VAD, task runtime, Agent DAG, event store, movie API or player implementation was rewritten.
- The V4 shell's active space is still in-memory state. Durable space preferences remain P6 work.
- The player and non-home routes are not wrapped by this P2 change.

## Verification status

- Source integration is committed to the feature branch.
- GitHub Actions must pass on the latest P2 head before this stage is called CI-verified.
- Preview rendering, real iPhone Safari interaction, and accessibility/device acceptance are separate checks and are not claimed by source integration or CI alone.
- `main`, production deployment and PR merge remain untouched.

## Next

1. Run the full branch CI and fix any failures on this feature branch.
2. Verify the home layout at desktop, iPad and iPhone breakpoints in Preview.
3. Proceed to P3 only after the P2 integration passes CI; P3 owns the complete six-state visual mapping and event contract.
