# LibreTV · FRIDAY SPATIAL OS V4
## P0 Compatibility Audit — Evidence-Based

**Repository:** `421581698/LibreTV`  
**Audit baseline:** `main`  
**V4 branch:** `feature/friday-spatial-os-v4`  
**Scope:** homepage, Friday visual/voice, task runtime, recommendation services, player/quality evidence, FMHY taxonomy  
**Mode:** read-only source inspection; no production or main-branch changes

---

## 1. Executive conclusion

V4 should be a presentation and composition rebuild over existing capability services. The current `main` already contains:
- a standalone Canvas 2D Friday renderer;
- separate browser ASR, TTS, VAD and voice-interruption modules;
- a Friday voice controller and chat/workflow session;
- a DAG orchestrator and event-sourced task runtime;
- a Dexie-backed browser-local task event store;
- real Douban, Bangumi and hot-list recommendation paths;
- playback-quality models that distinguish decoded playback evidence from playlist/source claims.

Do not rebuild these engines as part of the UI rewrite. V4 should introduce a new shell and view projections, then connect them through narrow adapters.

## 2. Compatibility matrix

| Capability | Source evidence on `main` | Decision | Notes / unresolved |
|---|---|---|---|
| Friday Canvas renderer | `src/components/friday/friday-orb-core.js`, `FridayOrb.tsx` | **KEEP** | Existing renderer is independent; size it through a new compact wrapper. |
| ASR | `src/components/friday/browserAsr.ts` | **KEEP** | Browser adapter; lifecycle belongs to controller. |
| TTS | `src/components/friday/browserTts.ts` | **KEEP** | Existing provider supports language/profile routing. |
| VAD capture | `src/components/friday/browserVadCapture.ts` | **KEEP** | Must serialize microphone ownership with Web Speech ASR on Safari/iOS. |
| Voice interruption | `src/components/friday/voiceActivityInterrupt.ts` | **KEEP** | Existing one-shot interruption controller. |
| Voice lifecycle | `src/components/friday/useFridayVoiceController.ts` | **KEEP** | UI must not directly start/stop ASR/TTS/VAD. |
| Chat/session orchestration | `src/components/friday/useFridayChatSession.ts` | **KEEP + ADAPT** | Existing hook coordinates chat, workflow, playback feedback and task store. |
| Friday FAB/panel shell | `src/components/AIFloatingBall.tsx`, `FridayStyles.tsx` | **REPLACE PRESENTATION** | Current component still combines panel, FAB, preferences and orchestration; CSS FAB is 68px and panel uses strong blur/dark glass. Extract a compact V4 view without duplicating hooks or session owners. |
| Homepage composition | `src/app/page.tsx`, `HomeIntentCanvas.tsx`, `HomeRecommendationSection.tsx` | **REFACTOR PRESENTATION** | Page currently composes header, search, intent canvas, results, detail modal, recommendations and footer. Keep data/controller behavior; move composition into V4 sections. |
| Recommendation UI/data | `HomeRecommendationSection.tsx`, `douban-section.tsx`, `api/douban/route.ts`, `api/hot-list/route.ts`, `lib/douban.ts` | **KEEP SERVICES; REDESIGN VIEW** | Douban supports movie/TV and tags; recommendation source can switch to Bangumi or hot-list. Use real cover URLs; no fabricated posters. |
| Task DAG | `src/lib/friday/dag-orchestrator.ts` | **KEEP** | Validates DAG, dependency execution, bounded retries and safe replay rules. |
| Task runtime | `src/lib/friday/task-runtime.ts` | **KEEP** | Event stream, snapshots, progress, checkpoint, waiting/resume, replay request. |
| Task event persistence | `src/lib/friday/task-service.ts`, `dexie-task-event-store.ts` | **KEEP + DOCUMENT LIMIT** | Client-side Dexie/IndexedDB local persistence; not a server-side cross-device event store. Restore reads up to 50 newest task-created streams. |
| Movie workflow | `src/lib/friday/movie-workflow.ts`, `movie-agents.ts` | **KEEP + ADAPT PROJECTION** | Search → source → quality → review → playback. Separate playback evidence task persists decoded observations. |
| Actual quality evidence | `movie-agents.ts`, `useFridayChatSession.ts` | **KEEP** | Types distinguish decoded playback height from playlist/segment or unknown source claims. Confirm actual player instrumentation path before claiming live measurement is wired. |
| Player shell | Not conclusively located in this path audit | **PENDING** | Need exact player route/component and its control/subtitle/source APIs before implementing responsive wrapper. |
| FMHY resource taxonomy | Upstream FMHY wiki index and Streaming page | **KEEP DATA PROVENANCE; VERIFY TAXONOMY** | User's 13-category requirement must be reconciled against the current upstream index before hardcoding categories. |

## 3. Confirmed source details

### 3.1 Friday visual and voice

- `FridayOrb.tsx` creates the Canvas renderer once and sends state/audio/theme/pause updates through its imperative engine.
- The current renderer's declared visual states are `IDLE`, `LISTENING`, `THINKING`, `SPEAKING`; V4's `EXECUTING` and `ERROR` should be presentation states mapped from task/runtime and error state, not fabricated renderer lifecycle states.
- `useFridayVoiceController.ts` owns browser speech recognition, TTS playback and interruption.
- `browserVadCapture.ts` explicitly warns against concurrent VAD and browser SpeechRecognition microphone ownership on Safari/iOS.
- `AIFloatingBall.tsx` owns a large amount of panel/session/preferences state; `FridayStyles.tsx` sets a 68px fixed FAB and a blurred glass panel. V4 should reduce the entry to 40–48px and expose a compact, accessible surface only on demand.

### 3.2 Homepage and recommendation

- `page.tsx` uses `Header`, `HomeSearchSection`, `HomeIntentCanvas`, `HomeRecommendationSection`, detail modal, search controller, app store and footer.
- `HomeIntentCanvas` renders `FridayHero` before its children; this is the current composition point where the large hero can dominate the top of the page.
- `HomeRecommendationSection` delegates to existing `RecommendSection`.
- `RecommendSection` selects Douban, Bangumi or hot-list based on user settings. Douban supports movie/TV types and tags; cards are already lazy-loaded.
- The API routes use request guards and server-side fetch/cache logic.

### 3.3 Task and quality workflow

- `TaskEvent` records event id, task id, sequence, type, timestamp, agent, payload and error.
- Runtime task states: queued, running, waiting, succeeded, failed, cancelled.
- DAG orchestration validates dependencies, bounds attempts (max 3), avoids replaying side-effect tasks, and reuses successful dependencies.
- Movie workflow stages are search, source, quality, review and playback.
- Quality assessment has explicit fields for decoded resolution, source resolution, sample count, min/max playback height and evidence provenance.
- The Dexie event store is browser-local. It uses transactional writes and contiguous per-task sequence validation; its recent restore path selects at most 50 newest created tasks.

## 4. FMHY taxonomy verification

The current FMHY wiki index is the source of truth, not a locally invented category array. Its visible top-level index includes:
- Adblocking / Privacy
- Artificial Intelligence
- Movies / TV / Anime
- Music / Podcasts / Radio
- Gaming / Emulation
- Books / Comics / Manga
- Downloading
- Torrenting
- Educational
- Tools
- Android / iOS
- Linux / macOS
- Non-English
- Miscellaneous

The wiki also presents Beginners Guide, Changelog, Backups and Discord as additional navigation sections. The current public beginner guide describes the directory as having 13 categories, while the visible wiki index currently exposes 14 resource headings if Miscellaneous is counted. **Do not silently force either count.** Before Resource Universe implementation, resolve the taxonomy mapping and decide which headings are categories versus utility/navigation sections. Preserve source titles, canonical links and update provenance.

References:
- FMHY wiki index: https://github.com/fmhy/FMHY/wiki
- FMHY Streaming page: https://github.com/fmhy/FMHY/wiki/Streaming
- FMHY beginner guide: https://fmhy.fyi/guide/

## 5. V4 implementation boundaries

### Build new presentation components
- `SpatialAppShell`
- `SpatialHome`, `HomeHero`, `RecommendationRails`
- `FridayAssistantButton`, `FridayAssistantSurface`, `FridayStatePresentation`
- `ResponsivePlayerShell`, `PlayerUtilityRail`, `QualityEvidenceSummary`
- Four space views and a responsive navigation system

### Reuse existing owners
- Reuse the existing app store, recommendation queries and source-selection behavior.
- Reuse `FridayOrb` renderer and the existing voice/chat hooks through one owner.
- Reuse `fridayTaskRuntime` and `fridayTaskEventStore`; build read-only UI projections over their snapshots/events.
- Reuse movie-agent adapters and playback evidence. Do not claim measured decode height until the player instrumentation is verified.

### Do not do
- Do not mount the old V1 `FridaySpatialOS` shell as V4 root.
- Do not create a second ASR/TTS/VAD controller.
- Do not create a second TaskRuntime or duplicate task event database.
- Do not replace the player or recommendation services before parity.
- Do not hardcode a 13-item FMHY array until the upstream taxonomy discrepancy is resolved.

## 6. Outstanding audit work before player implementation

1. Locate the exact player route/component and identify player engine, subtitle track handling, source switching, fullscreen/cast controls and decoded-height instrumentation.
2. Inspect `src/lib/db` schema to document IndexedDB table/index/version ownership and migration constraints.
3. Verify how Friday task/session history is restored and how long it remains available.
4. Resolve the FMHY category count/mapping against the current upstream data model.
5. Add V4 contract tests for compact assistant sizing, state projection, player safe areas and non-overlap with controls/subtitles.

## 7. Evidence classification

- **Source verified:** all explicit paths listed in the compatibility matrix were fetched from `main`.
- **Test verified:** not assessed in this audit pass; no claim of passing tests.
- **CI verified:** not assessed in this audit pass; no claim of green CI.
- **Runtime/browser verified:** not assessed; no claim of Preview, desktop, iPad or iPhone Safari acceptance.

## 8. Release boundary

V4 work remains on `feature/friday-spatial-os-v4`. Do not modify `main`, merge PRs, or deploy production without separate explicit approval.


## 9. P0 follow-up verification — 2026-11-08

This section supersedes any earlier P0 rows marked pending where the evidence below is now available.

### 9.1 Player and decoded-quality path — SOURCE VERIFIED

- Playback route: `src/app/watch/page.tsx`.
- Player implementation: `src/components/player-shell.tsx`, dynamically loaded by the watch page.
- Engine: ArtPlayer + hls.js; the ArtPlayer instance is retained across episode URL changes to avoid losing fullscreen/video context.
- Source/episode switching, subtitle and player controls remain in the existing player surface; V4 must compose around this owner rather than instantiate a second player.
- Decoded height is sampled from `art.video?.videoHeight` on loadedmetadata, canplay, resize and playing-related paths. The watch page persists measured quality and dispatches `friday-player-quality`; `useFridayChatSession` consumes that event and records playback evidence through the existing task runtime.
- Evidence precedence remains explicit: decoded playback > playlist/segment claim > unknown. Do not label source claims as measured quality.

### 9.2 Persistence — SOURCE VERIFIED

- Dexie database name: `libretv`.
- Schema versions: v1 history/progress/searchHistory; v2 liveProbe; v3 segmentMeta/downloads; v4 fridayTaskEvents; v5 adds the `[type+occurredAt]` index used to efficiently select recent task-created events.
- Friday task events are append-only IndexedDB records with event ID, task ID, sequence and timestamp indexes. Writes enforce contiguous per-task sequence numbers.
- `restoreAll()` reads the recent task streams (Dexie implementation selects up to 50 newest task-created records), validates streams and reconciles orphaned running/waiting tasks as interrupted. It does not automatically replay network side effects. Explicit bounded recovery is a user-initiated action.
- Conversation history is separate browser-local localStorage, keyed by assistant ID. It stores sanitized text messages only, capped at 30 messages / 2,000 characters per text part / 30 days; tool payloads are excluded. Storage denial is non-fatal.
- Playback history/progress is another separate IndexedDB concern. V4 must not merge space state, conversation state, playback state and task events into one store.

### 9.3 FMHY 13-category mapping — DECISION RECORDED

The 13-category Resource Universe navigation should follow the current official FMHY site sitemap, which explicitly labels its directory as **Categories (13)**:

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

The legacy GitHub Wiki index still exposes separate `Tools` and `Miscellaneous` headings, which explains the apparent 14-heading count. Treat that Wiki as legacy page/source provenance, not as the authoritative count for the new 13-item navigation. Preserve source page titles and canonical URLs in the data model; do not silently discard or rewrite source metadata when mapping legacy pages into the current 13-category navigation.

Authoritative category index: https://freemediaheckyeah.org/sitemap/ . Legacy provenance: https://github.com/fmhy/FMHY/wiki .

### 9.4 Test and CI evidence boundary

- The repository contains focused tests for ASR, TTS, VAD, voice controller/interruption, Canvas renderer, DAG orchestration, movie workflow, task runtime, conversation-history sanitization, playback feedback and player controls.
- Test files existing in the tree are **not** evidence that they pass. No local test command was executed in this audit session.
- The PR-triggered workflow-run lookup for the audited head returned no runs; this does not establish that CI is green or failed. CI remains unverified until a concrete workflow run for the current branch head is inspected.
- Preview, desktop browser, iPad and iPhone Safari remain unverified.

### 9.5 P0 disposition

| Item | Result |
|---|---|
| Existing capability inventory | Source verified |
| Player route and player owner | Source verified |
| Actual decoded-height event path | Source verified |
| Dexie schema and task restore semantics | Source verified |
| Conversation history limits | Source verified |
| FMHY 13-category navigation mapping | Decision recorded from official sitemap |
| Test execution | Not run |
| CI | Not verified |
| Preview / device acceptance | Not verified |

P0 source-compatibility audit is complete. P0 runtime/test acceptance is intentionally separate and must not be represented as complete. Proceed to P1 implementation on this feature branch only; do not modify `main`, merge a PR or deploy production.
