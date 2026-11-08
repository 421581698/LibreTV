# LibreTV · FRIDAY SPATIAL OS · UI Baseline V1.0
## Compatibility audit (Phase 0)

Audit baseline: `main` at `3eebdf24b0af6dbf5c999c72201e5fc24fddc91a` (tree contained 364 entries; GitHub tree response was not truncated).
Audit mode: read-only source inspection. No existing source file was modified by this audit.

## Existing capabilities confirmed by source inspection

| Capability | Existing source | Finding | Integration rule |
|---|---|---|---|
| Canvas sigil | `src/components/friday/FridayOrb.tsx`, `friday-orb-core.js` | Existing zero-dependency Canvas 2D renderer documents its eight-layer architecture and instance lifecycle. | Wrap the existing renderer; do not replace or duplicate it. |
| Homepage Friday entry | `src/components/friday/FridayHero.tsx`, `src/components/home/HomeIntentCanvas.tsx` | Homepage hero listens to voice-state and audio-level events. | Spatial scene consumes this state; avoid a second microphone controller. |
| Voice lifecycle | `useFridayVoiceController.ts`, `browserAsr.ts`, `browserTts.ts`, `browserVadCapture.ts`, `voiceActivityInterrupt.ts` | Existing controller owns ASR/TTS/VAD and interruption lifecycle. | No new ASR/TTS/VAD lifecycle in Spatial OS. |
| Agent state | `src/lib/friday/agent-state.ts` | Existing phase model includes idle, listening, recognizing, thinking, executing, rendering, result, recovering, error. | Map the richer phase model into six presentation states. |
| Task runtime | `src/lib/friday/task-runtime.ts` | Event-sourced task model supports progress, checkpoint, resume, retry, terminal outcomes. | Spatial task views are projections only. |
| Task persistence | `src/lib/friday/dexie-task-event-store.ts`, `src/lib/db.ts` | Browser-local Dexie store enforces event sequence uniqueness and contiguous writes. | Keep Task State in this store; do not create a competing task database. |
| Agent DAG | `src/lib/friday/dag-orchestrator.ts` | Existing capability-gated DAG orchestrator with dependency outputs and checkpoints. | New orchestration layer must delegate to this API. |
| Movie workflow | `src/lib/friday/movie-workflow.ts`, `movie-agents.ts` | Existing movie-specific workflow and agents. | Preserve current agent IDs, contracts and workflow behavior. |
| VOD player | `src/components/player-shell.tsx` | Existing ArtPlayer/HLS player with recovery, prefetch, controls and Friday player commands. | Cinematic space composes around it; no player replacement. |
| Live player | `src/components/live-player.tsx` | Separate live playback engine for HLS/FLV/native streams. | Keep independent from VOD player. |
| Source quality probe | `src/lib/quality-probe.ts`, `src/components/use-quality-probe.ts` | Server-side stream/segment inspection and browser queue exist. | Treat as source evidence, not actual playback decode evidence. |
| Homepage recommendations | `HomeRecommendationSection.tsx`, `HomeIntentCanvas.tsx` | Existing homepage composition and recommendation flow. | Preserve real recommendation data and detail-modal interaction. |

## Risks and unresolved verification

1. `FridayOrb.tsx` currently types four renderer states. The UI contract requires six. The adapter must map EXECUTING and ERROR without changing voice controller semantics.
2. `agent-state.ts` already has richer runtime phases than the requested six visual states. A one-way projection is required; do not collapse runtime phases.
3. The repository has both `FridayOrb.tsx` and `FridayOrbVisual.tsx`. The actual import graph and all consumers must be traced before removing or consolidating either.
4. The existing task event store is browser-local IndexedDB. It is durable within that browser profile, not a server-synchronized cross-device store. Do not describe it as cloud persistence.
5. Source quality probing parses playlists/segments. Actual decoded height must come from the active player/video element when available; these evidence types must remain separately labeled.
6. No verified FMHY top-level 13-category source map was found in this limited LibreTV source audit. The Streaming wiki page is a subdirectory, not proof of the wiki's top-level taxonomy. Resource ingestion must be generated from the official FMHY navigation/source and preserve canonical links.
7. Full iPhone Safari, playback, microphone permission and interruption behavior cannot be certified by static source inspection or CI alone.

## Required follow-up before integration is called complete

- Trace all Friday renderer imports and confirm one production Canvas owner.
- Inspect the complete player callback surface for decoded-height evidence.
- Verify Dexie schema/version and current Friday task table indexes before adding spatial/session tables.
- Retrieve the official FMHY top-level navigation and record source revision/date.
- Add focused unit tests for persistence isolation, router history, panel focus and six-state projection.
- Run the repository's actual CI workflows on the integration branch; report CI separately from device acceptance.
