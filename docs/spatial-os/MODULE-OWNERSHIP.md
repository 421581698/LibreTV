# Module ownership and dependency boundaries

## New Spatial OS ownership

| Module | Owns | Must not own |
|---|---|---|
| SpatialStateStore | Active space, per-space layout, focus, expansion depth, panel order and view-local filters. | Conversation, task events, player state, browser route. |
| SpatialRouter | In-app space activation, expansion stack and spatial back history. | Next.js router, URL navigation, page lifecycle. |
| PanelManager | Panel registration, focus arbitration, z-order, docking and non-overlap policy. | Task execution, voice lifecycle, player controls. |
| WorkspacePersistence | Versioned persistence adapters and migration of Spatial/Session/Task references. | Duplicate task-event storage or replacement of existing user preferences. |
| TaskOrchestrator | Natural-language intent decomposition and projection into existing task/agent APIs. | A second DAG engine or direct reimplementation of agents. |
| QualityVerifier | Evidence aggregation with explicit provenance and confidence. | Claiming source metadata is decoded playback evidence. |
| ResourcePortal | FMHY navigation, source metadata, search/filter/favorites and safe external-link handoff. | Replacing movie search or silently proxying third-party sites. |
| CinematicPortal | Composition of existing VOD/live players, recommendations, subtitles and continue-watching UI. | Owning media engines or obscuring native player controls. |
| IntelligencePortal | Friday conversations, task projections, agent outcomes and quality evidence. | ASR/TTS/VAD lifecycle or task persistence. |
| IdentityPortal | Existing preferences, history, favorites and settings presentation. | Creating a second user identity/settings store. |
| ResponsiveScene | Breakpoint-specific composition and reduced-motion/performance policy. | Duplicating business state. |

## Existing module ownership (preserve)

- `useFridayVoiceController`: microphone permission, recognition lifecycle, TTS lifecycle, VAD interruption, cancellation and cleanup.
- `browserAsr`, `browserTts`, `browserVadCapture`, `voiceActivityInterrupt`: browser media/voice adapters.
- `friday-orb-core.js`: Canvas 2D rendering kernel and animation lifecycle.
- `TaskRuntime` + `DexieTaskEventStore`: task event sequence, snapshots, checkpoints and replay.
- `dag-orchestrator.ts`: dependency scheduling, capability checks, retries and checkpoint forwarding.
- `PlayerShell` and `LivePlayer`: media engine lifecycle and playback controls.
- `quality-probe` and `use-quality-probe`: source-side stream inspection and queueing.

## Dependency direction

Spatial UI -> projection/adapters -> existing Friday runtime / existing player / existing data stores.

Existing runtime modules must not import Spatial UI. SpatialRouter must not import Next.js navigation. The spatial layer is disposable presentation state; existing runtime state remains authoritative.
