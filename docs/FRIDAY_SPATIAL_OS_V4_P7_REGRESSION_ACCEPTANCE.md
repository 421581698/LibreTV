# FRIDAY SPATIAL OS V4 — P7 Regression Acceptance

## Scope

P7 is the cross-layer regression gate for the V4 shell and its preserved V3 capability engines. It is not a substitute for deployed Preview or physical-device acceptance.

## Automated regression coverage

Added `src/components/spatial-os-v4/spatial-os-v4-regression.test.ts` with nine contracts:

1. Four-space navigation model, invalid-space fallback and persisted active-space restoration.
2. One V4 shell, selected workspace rendering and preservation of Cinematic search/recommendation/detail flows.
3. Friday entry remains a visual adapter; the existing AIFloatingBall/controller owns the orb-toggle event and voice lifecycle.
4. Intelligence opens the existing Friday panel and displays redacted task audit summaries only.
5. Resource Universe uses the FMHY API, category/search parameters, pagination, favorites and saved query/category state.
6. Identity delegates history, source settings and Friday settings to existing owners, and uses the existing profile transfer/migration path.
7. Watch page keeps the dynamic PlayerShell, ArtPlayer/HLS and decoded video-height measurement while applying responsive layout classes.
8. Desktop/tablet/mobile navigation, safe-area padding, focus-visible affordance and reduced-motion CSS contracts.
9. No implied cloud sync and no automatic task side-effect replay.

Existing suites continue to cover Friday reducer/visual-state mapping, homepage/player business contracts, FMHY pagination and favorites, Dexie persistence, task recovery and profile import/export.

## CI evidence

- Commit: `3ebeac921b80898e621347b77f663ae836601fc4`
- Workflow run: [42500748524](https://github.com/421581698/LibreTV/actions/runs/42500748524)
- TypeScript: passed
- ESLint: passed
- Unit tests: **849 passed across 76 test files**
- Production build: passed

The run is green. Two earlier runs failed only because the new static regression assertions targeted the wrong owner/string; those assertions were corrected and the final run above passed.

## Private Preview deployment

- Preview workflow: [42501095284](https://github.com/421581698/LibreTV/actions/runs/42501095284)
- Source commit: `ee5573d8788bb0109607008097a5242286d5fbb2`
- Worker: `https://libretv-homepage-preview.bggdbh.workers.dev/`
- OpenNext Cloudflare build: passed
- Cloudflare credential and dedicated preview gate-key checks: passed
- Worker deployment: passed
- Preview `PASSWORD` secret installation: passed
- `/api/status` smoke check confirms `passwordRequired=true` and `verified=false` for anonymous sessions; invalid password returns HTTP 401.

This is an isolated protected Preview Worker. It is not the production Worker. The browser tool could not render the protected Preview URL, so visual interaction acceptance remains outstanding.

## Manual acceptance still required

| Environment | Acceptance | Status |
|---|---|---|
| Preview deployment | Build/deploy/authentication gate | Passed; visual inspection pending |
| Desktop browser | Navigation, keyboard focus, content overflow, Friday interaction | Not verified |
| iPad Safari | Sidebar composition, touch targets, orientation changes | Not verified |
| iPhone Safari | Bottom navigation, safe area, player viewport and scroll | Not verified |
| iPhone Safari voice | Permission denial, repeated ASR turns, interruption, TTS stop, close/reopen cleanup | Not verified |
| Browser storage | Real IndexedDB quota/private-mode and multi-tab behavior | Not verified |

CI validates static and unit-level contracts. It does not prove that the Preview is deployed, that CSS renders correctly in a browser, or that iPhone Safari voice/storage behavior works.

## Release boundary

- No merge to `main`.
- No production deployment.
- V4 remains on `feature/friday-spatial-os-v4`.
- P7 automated CI is accepted; P7 overall remains pending the manual Preview/device matrix above.
