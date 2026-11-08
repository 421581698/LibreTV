# LibreTV · FRIDAY SPATIAL OS V4
## Phase 0 — Compatibility & Source Audit

**Audit branch:** `feature/friday-spatial-os-v4`  
**Repository default branch:** `main`  
**Audit method:** GitHub source inspection of `main`, plus read-only inspection of PR #54 files where explicitly noted.  
**Production/main changes:** none.  
**Scope:** homepage data, Friday renderer and voice lifecycle, Agent/Task runtime, VOD/live players, quality evidence, FMHY resource taxonomy, V1 reuse boundary.

## 1. Executive decision

V4 should be a presentation and composition rebuild, not a rewrite of the product engines.

The current `main` branch already contains the critical runtime capabilities needed by V4: Canvas 2D Friday rendering, voice lifecycle modules, an event-sourced task runtime, a capability-gated DAG orchestrator, separate VOD/live player implementations, real decoded-height reporting, server-side source probing, and real homepage recommendation APIs.

The V4 branch must therefore create a new product shell and UI projection layer while consuming those existing contracts. It must not mount the PR #54 V1 shell as its root and must not fork a second voice controller, task runtime, player engine, or quality store.

## 2. Compatibility matrix

| Capability | Source evidence | Status | V4 action |
|---|---|---|---|
| Friday Canvas renderer | `src/components/friday/FridayOrb.tsx`, `friday-orb-core.js` | **KEEP** | Reuse the existing Canvas engine and its lifecycle. Rebuild only the small button/surface wrapper and sizing. |
| Friday visual states | `FridayOrb.tsx` currently types IDLE/LISTENING/THINKING/SPEAKING; core validates those four | **ADAPT** | Keep renderer state inputs within supported states. Present EXECUTING and ERROR in the surrounding UI/state projection; do not pretend the current Canvas core already implements six native states. |
| Voice lifecycle | `useFridayVoiceController.ts`, `browserAsr.ts`, `browserTts.ts`, `browserVadCapture.ts`, `voiceActivityInterrupt.ts` | **KEEP** | Existing controller remains the sole owner of ASR/TTS/VAD, interruption, cleanup and permission errors. V4 consumes its observable state and callbacks. |
| Homepage Friday composition | `FridayHero.tsx`, `HomeIntentCanvas.tsx` | **REFACTOR PRESENTATION** | Replace large/hero presentation with the compact 40–48 px entry and explicit expanded surface. Preserve the existing controller wiring. |
| Agent phase model | `src/lib/friday/agent-state.ts` was referenced by PR #54 audit but the path did not resolve in the current main fetch; verify exact current path before importing | **VERIFY** | Do not hardcode a guessed module path. Trace actual imports before writing the V4 adapter. |
| Task runtime | `src/lib/friday/task-runtime.ts` | **KEEP** | Event types include created/started/progress/checkpoint/waiting/resumed/succeeded/failed/cancelled/replay_requested. V4 task UI is a projection only. |
| Task event persistence | `src/lib/friday/dexie-task-event-store.ts`, `src/lib/db.ts` | **KEEP** | Existing browser-local Dexie/IndexedDB store enforces unique event IDs, contiguous per-task sequences and transactional append. It is not cloud or cross-device persistence. |
| Agent DAG | `src/lib/friday/dag-orchestrator.ts` | **KEEP** | Reuse validated dependency graph, capability checks, checkpoint-aware execution, retry/replay rules. V4 does not implement a second orchestrator. |
| VOD player | `src/components/player-shell.tsx` | **KEEP** | ArtPlayer + HLS, recovery, prefetch, control and playback API remain authoritative. Recompose its surrounding layout only. |
| Live player | `src/components/live-player.tsx` | **KEEP** | Keep the separate HLS/FLV/native playback path. Do not force live playback through the VOD shell. |
| Actual decoded quality | `player-shell.tsx` reports `art.video.videoHeight` on loadedmetadata/canplay/resize through `onQuality` | **KEEP** | This is the actual decoded-height evidence. Preserve provenance and never conflate it with source probe claims. |
| Source quality probe | `src/lib/quality-probe.ts`, `src/components/use-quality-probe.ts` | **KEEP** | Preserve playlist/segment probing as source evidence, separate from actual decoded player evidence. |
| Homepage recommendations | `src/app/api/douban/route.ts`, `src/app/api/hot-list/route.ts`, `HomeRecommendationSection.tsx`, `HomeIntentCanvas.tsx` | **KEEP DATA PATH / REFACTOR UI** | Continue using real API data and real poster URLs. Do not introduce mock/filler poster data. |
| Existing V1 spatial shell | PR #54 / `feature/friday-spatial-os-v1` | **DO NOT USE AS V4 ROOT** | Keep PR #54 intact as reference and rollback point. Reuse only individually reviewed data/contracts where appropriate. |
| V1 workspace store and panel model | PR #54 `SpatialStateStore`, `WorkspacePersistence`, `PanelManager` | **RE-DESIGN** | Do not copy the V1 global panel toolbar/single focused-panel architecture into V4. Define V4 state around content-first navigation and task context. |
| FMHY taxonomy/data | PR #54 `fmhy-categories.ts`, category JSON, `FMHY-RESOURCE-MAP.md` | **REUSE AFTER PROVENANCE REVIEW** | The PR branch includes 13 root categories and a documented local snapshot. Port the category map/data selectively after verifying source revision, URLs, attribution and tests; do not redirect the whole space to a wiki page. |

## 3. Confirmed source details

### 3.1 Friday renderer and voice

- `FridayOrb.tsx` creates one Canvas engine instance and exposes imperative resize/state/audio methods.
- The renderer currently supports four native animation states: IDLE, LISTENING, THINKING and SPEAKING.
- The core source describes its eight-layer Canvas 2D drawing architecture and day/night themes.
- `useFridayVoiceController.ts` owns recognition and speech lifecycle state, including microphone permission/error handling, recognition instance retirement, pending starts, TTS playback and voice interruption.
- V4's six product presentation states are IDLE, LISTENING, THINKING, EXECUTING, SPEAKING and ERROR. EXECUTING and ERROR must be represented by the outer UI/task projection until a separately tested renderer extension is approved.

### 3.2 Task and Agent runtime

- `TaskRuntime` stores task events and reconstructs snapshots from event streams.
- Task events include checkpoint and resume events; task status includes queued, running, waiting, succeeded, failed and cancelled.
- `DexieTaskEventStore` uses the existing `libretv` Dexie database. Appends are transactional; event sequence numbers must be contiguous and unique per task.
- This persistence is local to the browser profile. Cross-device task synchronization is not evidenced and must not be promised.
- `dag-orchestrator.ts` validates dependency graphs and uses capability-gated agents with checkpoint-aware retry/replay behavior.

### 3.3 Player and quality evidence

- VOD is implemented by `PlayerShell` using ArtPlayer and hls.js. Its comment explicitly avoids rebuilding the ArtPlayer instance on source/episode changes to protect fullscreen and video-element continuity.
- Live playback is a separate component and supports HLS, FLV and native media paths.
- VOD reports `video.videoHeight` after loadedmetadata/canplay and native resize events. This is the strongest actual playback decode evidence.
- Server-side `quality-probe.ts` inspects playlists and media segments. That result is source/stream evidence, not proof of what the browser ultimately decoded.
- V4 must show these as distinct evidence labels, e.g. “源探测” versus “播放器实测”.

### 3.4 Homepage data

- `/api/douban` fetches real Douban recommendations server-side.
- `/api/hot-list` fetches real hot-list data through the configured upstream.
- Homepage sections already consume recommendation data. V4 should replace their layout and styling without inventing posters or changing upstream semantics.

### 3.5 FMHY resources

PR #54's branch includes the following 13 root categories in `fmhy-categories.ts`:

1. Adblocking / Privacy
2. Artificial Intelligence
3. Movies / TV / Anime
4. Music / Podcasts / Radio
5. Gaming / Emulation
6. Books / Comics / Manga
7. Downloading
8. Torrenting
9. Educational
10. Android / iOS
11. Linux / macOS
12. Non-English
13. Miscellaneous Tools

The same PR includes category JSON datasets and a source map describing the upstream snapshot. This confirms the intended taxonomy exists in the PR branch, not in current `main`. Before porting it into V4, verify the recorded source commit IDs, canonical URLs, attribution, parser completeness tests and any licensing constraints. The FMHY Streaming wiki page is a subdirectory reference, not a substitute for the root taxonomy.

## 4. V4 product and implementation boundaries

### Keep unchanged at first
- Friday Canvas engine and its instance lifecycle.
- Existing ASR/TTS/VAD and voice interruption controller.
- TaskRuntime, DexieTaskEventStore and DAG orchestrator.
- VOD and live player engines.
- Actual decoded-height callback and source quality probe.
- Recommendation APIs and existing data contracts.

### Rebuild in V4
- App shell, top navigation and theme application.
- Homepage composition for light/dark modes.
- Compact Friday entry, expanded assistant surface and six-state UI projection.
- Desktop/iPad/iPhone player layout around the existing engines.
- Four-space navigation and page composition.
- Task progress/result presentation.
- Resource directory presentation and local search/filter UX.

### Do not carry forward without redesign
- V1 root shell and its vertical stacking of Friday, panel toolbar, space navigation and legacy homepage.
- V1 global six-button panel toolbar.
- Global single focused/expanded panel semantics.
- V1 portal pass-through pattern where a “space” merely wraps legacy children.
- Any duplicated voice, task, quality or player state.

## 5. V4 target component boundary

```
src/components/spatial-os-v4/
  app/
    SpatialAppShell.tsx
    SpatialLayout.tsx
  navigation/
    PrimaryNavigation.tsx
  home/
    SpatialHome.tsx
    HomeHero.tsx
    RecommendationRails.tsx
  friday/
    FridayAssistantButton.tsx
    FridayAssistantSurface.tsx
    FridayStatePresentation.ts
  spaces/
    CinematicSpace.tsx
    IntelligenceSpace.tsx
    ResourceSpace.tsx
    IdentitySpace.tsx
  player/
    ResponsivePlayerShell.tsx
    PlayerUtilityRail.tsx
    QualityEvidenceSummary.tsx
  state/
    SpatialStateStore.ts
    SessionProjection.ts
    TaskProjection.ts
  styles/
    tokens.css
```

This is a proposed boundary, not a statement that these files already exist. V4 state must remain presentation/session state and must not duplicate TaskRuntime or the voice controller.

## 6. Remaining blockers before implementation

1. Trace every Friday renderer import/consumer and determine whether `FridayOrbVisual.tsx` is still used; do not delete either renderer wrapper without an import-graph audit.
2. Fetch the exact current source for the Friday phase/state module and trace the controller-to-UI subscription contract.
3. Inspect player page parents and callback wiring to map all controls and quality callbacks into the responsive shell.
4. Inspect Dexie database version history and indexes before adding any new session/spatial persistence tables.
5. Verify FMHY category JSON against its recorded upstream source commits and tests before porting.
6. Inspect current test scripts and CI workflow definitions on `main`; do not infer green CI from previous branch runs.
7. Browser visual acceptance and iPhone Safari voice/playback acceptance remain separate from static audit and CI.

## 7. Acceptance and release boundaries

- No changes to `main`.
- No merge of PR #54 or any V4 PR.
- No production deployment.
- V4 implementation remains on `feature/friday-spatial-os-v4`.
- Report unit tests, CI, Preview visual review, and iPhone Safari testing as separate evidence.
