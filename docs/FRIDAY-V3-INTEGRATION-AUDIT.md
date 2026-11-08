# Friday V3 — Integration Audit

> Audit baseline: `main` at `2001be7f9498abfb3eb97c719242aa14502cc931`  
> Date: 2026-11-08  
> Scope: DAG entry point, real LibreTV adapters, failure/cancellation/retry/restore, protected chat/detail/player contracts, and reference-project migration matrix.

## 1. Executive summary

The DAG is **connected to the real Friday AI conversation path**. It is not only a standalone test fixture. The current implementation is nevertheless **not production-complete as a resumable/retryable workflow engine**.

| Audit item | Result | Evidence / limitation |
|---|---|---|
| DAG reached from Friday task entry | PASS | `useFridayChatSession.handleData` receives the `data-movies` UI data part and calls `runLibreTVMovieWorkflow` |
| Search uses real LibreTV data | PASS | `/api/chat` `search_movie` calls `searchSources`; workflow deliberately reuses the exact returned movie results |
| Source probing uses real data | PASS WITH SCOPE NOTE | Source Agent calls browser adapter `/api/quality`; server uses `probeQuality`, HLS playlist and media segment parsing |
| Quality assessment uses measured values | PASS WITH LIMITATION | It consumes returned resolution height and reachability; current adapter does not provide per-source latency or advertised-quality measurements |
| Review agent evidence matching | NEEDS HARDENING | Review checks structural association, but a passing review is not proof that every source yielded a measured resolution |
| Failure propagation | PARTIAL | Failed agent is recorded; dependent tasks are marked failed; workflow view becomes incomplete. DAG currently hardcodes agent errors as `retryable: false` |
| Cancellation | PARTIAL / BASIC PATH WORKS | Chat stop and component unmount abort active workflow controllers; AbortSignal is passed to adapters; DAG records cancelled nodes. No durable cancel/resume coordinator exists |
| Retry | NOT COMPLETE | Runtime can record a replay request only for retryable failures, but DAG marks failures non-retryable and no workflow-level replay executor consumes replay events |
| Reload recovery | DISPLAY ONLY | IndexedDB restores up to 50 task histories; running tasks are intentionally not resumed; restored snapshots are shown as history |
| Existing chat/detail/player contracts | PRESERVED BY STATIC REVIEW | `/api/chat`, `data-movies`, `friday-open-detail`, `DetailModal`, homepage search and player paths remain separate; this audit did not execute a browser playback session |

## 2. Actual DAG entry path

```text
Friday user message
  -> POST /api/chat
  -> search_movie tool
  -> searchSources(keyword, enabledSources, filterAdult, request.signal)
  -> mergeSearchResults(...)
  -> data-movies UI stream part
  -> useFridayChatSession.handleData(...)
  -> createLibreTVMovieAgentAdapters(...)
  -> runLibreTVMovieWorkflow(...)
  -> runFridayDag(...)
  -> TaskRuntime + DexieTaskEventStore
  -> workflowBySearchId
  -> FridayConversation / WorkflowSummary
```

Important: the workflow's Search Agent adapter is intentionally overridden to map the already-returned server search results. This avoids a duplicate search request and ensures the workflow assesses the same candidates shown in the conversation.

## 3. Four movie agents: real data and boundaries

### Search Agent

- Entry source: `/api/chat` `search_movie`.
- Real operation: `searchSources` with current enabled sources and adult filter.
- Workflow input: the exact `data-movies.results` payload, mapped to candidate ID `sourceKey:vodId`.
- It does not issue a second search request. This is intentional.
- The generic adapter's `search` implementation calls `/api/search`, but the current conversation path overrides it.

### Source Agent

- Calls `createLibreTVMovieAgentAdapters(...).probe`.
- Uses `POST /api/quality`, batched at no more than 50 candidates per request.
- The server endpoint uses `probeQuality`, host concurrency limits, SSRF checks, cache and HLS/segment parsing.
- The current adapter's `reachable` value means a quality-probe response returned without an error. It should not be marketed as a separate TCP/HTTP uptime monitor.
- Per-source latency is currently not returned by `/api/quality`; do not render or claim it as measured latency.

### Quality Agent

- Consumes the Source Agent's actual probe results.
- Uses numeric `resolutionHeight` only when supplied and positive.
- Emits `resolution_detected`, `resolution_unknown`, `unavailable` or `unknown`.
- It must not convert advertised labels such as “4K” into measured resolution.
- Source-side playlist/segment resolution is not decoded player `videoHeight`.

### Review Agent

- Validates candidate-to-assessment association and the evidence attached to measurements.
- Its current result is a structural/evidence review, not a playback certification.
- UI wording must not imply that all candidates have confirmed resolution when an assessment is merely unknown.

## 4. Failure, cancellation, retry and restoration

### Failure

Current behavior:
- Agent exceptions are caught by `runFridayDag`.
- The active task receives `task.failed`.
- Downstream nodes are prevented from running and receive `DEPENDENCY_FAILED`.
- `useFridayChatSession` maps non-all-success results to an incomplete workflow view.

Gap:
- The orchestrator currently writes every caught agent error with `retryable: false`. There is no transient/permanent error classifier or retry budget.
- A task may fail and be visible, but the user cannot safely replay the failed workflow through the current UI.

### Cancellation

Current behavior:
- `stopChat` aborts all active workflow controllers and calls the AI SDK stop function.
- Component cleanup aborts active workflow controllers.
- AbortSignal is passed to the real `/api/quality` fetch; the server probe uses the request signal.
- The DAG checks the signal before starting a node, before recording progress/checkpoints, and after agent completion; cancelled tasks are persisted.

Limitations:
- There is no persisted workflow-level cancellation command or explicit cancel action for an individual task history entry.
- Cancellation during a store write or after an upstream endpoint has already completed still depends on the timing of the signal; UI stale-result protection is handled separately by the workflow request guard.

### Retry / replay

Current behavior:
- `TaskRuntime.requestReplay` records `task.replay_requested` only when the task is failed and its error is explicitly retryable.
- Automatic replay of side-effect tasks is blocked.

Blocking gaps:
- The DAG catch path currently sets `retryable: false` for all agent failures.
- No caller in the current Friday workflow invokes `requestReplay`.
- No replay worker reconstructs the graph and resumes from the stored checkpoint.
- Calling `runLibreTVMovieWorkflow` again with the same task ID prefix fails because the task IDs already exist.
- Therefore retry/replay is an event-contract prototype, not a completed user-facing capability.

### Reload recovery

Current behavior:
- Dexie/IndexedDB persists append-only events with unique event IDs and contiguous per-task sequence numbers.
- `restoreAll` reconstructs up to the 50 most recently created task snapshots.
- The UI explicitly labels previously running tasks as not auto-resumed after reload.

Conclusion:
- Audit history restoration works.
- Execution restoration does not. A running task remains a historical running snapshot and is not resumed, reconciled or marked abandoned after reload.
- This is a deliberate safety boundary today, not a completed crash-recovery system.

## 5. Existing LibreTV contracts checked

| Contract | Audit result | Protected implementation |
|---|---|---|
| AI conversation transport | Preserved | `useFridayChatSession` continues to use AI SDK `DefaultChatTransport` and `/api/chat` |
| Movie search | Preserved | `search_movie` still uses LibreTV `searchSources` and returns the `data-movies` stream part |
| Movie cards | Preserved | `FridayMovieResults` forwards selected movie payload through `onOpen` |
| Detail modal | Preserved by bridge | `useFridayMovieTransition` dispatches `friday-open-detail`; `useFridayDetailBridge` validates/resolves the source and calls the existing page detail state |
| Player | No direct replacement found | Existing detail selection and playback remain outside the DAG; no browser playback regression test was executed as part of this static audit |
| Homepage search | Separate | `HomeSearchSection` and `HomeContent` retain the native search form and query/result pipeline |

Existing regression coverage to keep in CI:
- `src/components/home/homepage-playback-regression.test.ts`
- `src/components/friday/useFridayRequestLifecycle.test.ts`
- `src/components/friday/workflowRequestGuard.test.ts`
- `src/lib/friday/dag-orchestrator.test.ts`
- `src/lib/friday/movie-workflow.test.ts`
- `src/lib/friday/task-runtime.test.ts`

This document records static source review. It does not claim that typecheck, lint, Vitest, preview deployment or physical iPhone playback was run during this audit.

## 6. Required follow-up gates before calling V3 workflow complete

1. Add a typed error taxonomy and retry policy; only known transient failures become retryable.
2. Implement a workflow-level replay coordinator that creates a new execution identity, records lineage to the original run, and revalidates dependencies/checkpoints. Do not replay side-effect tasks automatically.
3. Reconcile orphaned `running` tasks on reload as interrupted/abandoned; do not silently resume microphone, network or side-effect work.
4. Make review output distinguish “assessment completed” from “resolution measured”; enforce candidate-level assessment coverage.
5. If source latency is required, add an explicit server response field with defined semantics (source-origin duration versus API round-trip); never label batched API wall time as per-source latency.
6. Add integration tests for the actual `data-movies -> workflow` entry, cancellation while search/probe is in flight, dependency failure, retry lineage, and reload reconciliation.
7. Run `npm run typecheck`, `npm run lint`, `npm test`, GitHub Actions and a deployed preview smoke test.
8. Manually verify on iPhone Safari: repeated microphone starts, stop during ASR, stop during TTS, search result cards, detail modal, episode selection and playback.

## 7. Branch hygiene

At audit time, `feature/friday-v3-runtime` is 29 commits behind `main` and 0 commits ahead. It must not be treated as the current integration base. This audit work is isolated on a new branch based on the audited `main` SHA; the old branch is left untouched.