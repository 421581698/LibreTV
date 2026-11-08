# State mapping and persistence contract

## Friday presentation state

The requested six visual states are a presentation projection, not a replacement runtime state machine.

| Visual state | Existing runtime inputs | Presentation |
|---|---|---|
| IDLE | idle / ready / completed | Calm gold core, no active task emphasis. |
| LISTENING | voice listening / microphone active | Audio-reactive particles and listening affordance. |
| THINKING | recognizing / thinking / planning | Accelerated orbit and planning indicator. |
| EXECUTING | task executing / tool running | Core brightens; task panels expand. |
| SPEAKING | voice speaking / TTS active | Gold membrane pulse; interrupt affordance remains available. |
| ERROR | voice error / task error / unrecoverable request error | Soft warning, error detail and retry/recovery action. |

Do not map `recovering` to ERROR automatically. Recovery is a runtime phase; it can be presented as THINKING or a dedicated recovery detail until a terminal error is confirmed. Do not map task completion to voice completion unless the runtime explicitly reports both.

## Three independent persistence domains

### Spatial State
- Active space and previous-space stack.
- Per-space expansion depth, panel layout/order, focused panel.
- Scroll offsets and local filters.
- Versioned schema; tolerate missing/unknown fields and reset invalid layout fragments safely.

### Session State
- Conversation/session identifiers and user-visible conversation history.
- Assistant/language/voice preferences only through existing preference contracts.
- Never persist microphone streams, raw audio buffers or transient permission objects.

### Task State
- Existing `TaskRuntime` and `DexieTaskEventStore` remain authoritative.
- Event sequence, progress, checkpoints, dependencies, outputs and retry state remain in the existing event model.
- Spatial views store task IDs/references, not copies of task event streams.

## Persistence guarantees
- Spatial layout writes must not block playback or voice callbacks.
- Session writes must not overwrite task events.
- Task replay must reconstruct from the event store, not from a UI snapshot.
- Storage unavailable/quota errors must degrade to in-memory spatial state without corrupting existing LibreTV stores.
- Browser-local IndexedDB is not cross-device synchronization.
