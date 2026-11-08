# Friday V3 — Integration Audit

> Audit baseline: `main` at `dba11d31e972b3bf3a0053ba19a84c7e11f2b1d9`  
> Date: 2026-11-08  
> Scope: DAG entry point, real LibreTV adapters, failure/cancellation/retry/restore, protected chat/detail/player contracts, and reference-project migration matrix.

## 1. Executive summary

The DAG is **connected to the real Friday AI conversation path**. It is not only a standalone test fixture. The current implementation has bounded retry/replay and browser-local interruption reconciliation, but it is **not a general-purpose resume engine**: interrupted network work and side effects are deliberately not resumed.

| Audit item | Result | Evidence / limitation |
|---|---|---|
| DAG reached from Friday task entry | PASS | `useFridayChatSession.handleData` receives the `data-movies` UI data part and calls `runLibreTVMovieWorkflow` |
| Search uses real LibreTV data | PASS | `/api/chat` `search_movie` calls `searchSources`; workflow deliberately reuses the exact returned movie results |
| Source probing uses real data | PASS WITH SCOPE NOTE | Source Agent calls browser adapter `/api/quality`; server uses `probeQuality`, HLS playlist and media segment parsing |
| Quality assessment uses measured values | PASS WITH LIMITATION | It consumes parsed manifest/segment resolution, reachability and per-item probeDurationMs; it does not measure source-origin RTT or decoded player videoHeight |
| Review agent evidence matching | PASS WITH SCOPE NOTE | Review validates candidate-to-assessment evidence association and coverage; it does not certify decoded player resolution or successful playback |
| Failure propagation | PASS WITH SCOPE NOTE | Failed agents and dependent failures are persisted; transient errors can be classified as retryable within a bounded DAG retry policy |
| Cancellation | IMPLEMENTED FOR ACTIVE SESSION | Chat stop and component unmount abort active workflow controllers; AbortSignal reaches search/quality adapters and the DAG persists cancellation. There is no cross-reload cancellation/resume coordinator; in-flight external work is not resumed |
| Retry / replay | IMPLEMENTED WITH SAFEGUARDS | Workflow exposes retry for eligible failed steps; DAG supports bounded transient retries and explicit failed-task replay. Side-effect tasks remain blocked; this is not arbitrary resume of an in-flight run |
| Reload recovery | HISTORY RESTORE + INTERRUPTION RECONCILIATION | IndexedDB restores recent task history; orphaned running tasks are recorded as `TASK_INTERRUPTED` and non-retryable. No microphone, network, or side-effect work is automatically resumed |
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
- The adapter forwards probeDurationMs, probeResultCached, and parsed resolution evidence into the agent pipeline and conversation UI.
- /api/quality returns probeDurationMs for each item. It measures server-side per-item elapsed time (including host-gate wait and probe work; cached values retain the original measured duration). It is not source-origin RTT or a clean source-only network latency measurement. latencyMs remains unavailable/null.

### Quality Agent

- Consumes the Source Agent's actual probe results.
- Uses numeric `resolutionHeight` only when supplied and positive.
- Emits `resolution_detected`, `resolution_unknown`, `unavailable` or `unknown`.
- It must not convert advertised labels such as “4K” into measured resolution.
- Source-side playlist/segment resolution is not decoded player videoHeight.
- probeDurationMs is a per-item server-side elapsed duration, not source RTT. The current UI labels this distinction explicitly.

### Review Agent

- Validates candidate-to-assessment association and the evidence attached to measurements.
- Its current result is a structural/evidence review, not a playback certification.
- UI wording must not imply that all candidates have confirmed resolution when an assessment is merely unknown.

## 4. Failure, cancellation, retry and restoration

### Failure

Current behavior:
- Agent exceptions are caught by `runFridayDag`.
- The active task receives `task.failed`; downstream nodes are prevented from running and receive `DEPENDENCY_FAILED`.
- `useFridayChatSession` maps non-all-success results to an incomplete workflow view.
- The DAG classifies eligible transient failures and applies a bounded automatic retry budget.
- Failed tasks retain retryability only when the error policy explicitly permits it; dependent-task retryability follows the failed prerequisite.
- The workflow UI exposes a retry action for eligible failed steps and starts a new workflow execution identity with lineage to the prior tasks.
- Successful dependency outputs can be reused during explicit failed-step replay; side-effect tasks are excluded from automatic and explicit replay.

Limitations:
- This is bounded failed-step retry/replay, not general resumption of an interrupted in-flight execution.
- Retry eligibility is policy-driven; a visible retry control is not evidence that every failure is retryable.

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
- `TaskRuntime.requestReplay` records `task.replay_requested` only for failed tasks whose persisted error is explicitly retryable, subject to a per-task manual replay limit.
- `runLibreTVMovieWorkflow` and the DAG orchestrator support an explicit failed-step replay path with a fresh execution identity and task lineage; successful prerequisite outputs may be reused.
- The DAG classifies transient failures and applies a bounded automatic retry policy. Retryability is not assigned indiscriminately to all errors.
- Side-effect tasks are blocked from automatic and explicit replay.
- The Friday conversation session exposes a retry action for eligible failed workflow steps.

Limitations:
- Replay is limited to eligible failed work; it is not a general-purpose resume mechanism for interrupted or partially completed external side effects.
- A new execution identity is required; reusing an existing task ID prefix is not the supported retry strategy.

### Reload recovery

Current behavior:
- Dexie/IndexedDB persists append-only events with unique event IDs and contiguous per-task sequence numbers.
- `restoreAll` reconstructs up to the 50 most recently created task snapshots.
- The UI explicitly labels previously running tasks as not auto-resumed after reload.

Conclusion:
- Recent task history is restored from browser-local IndexedDB.
- Any task left in `running` when the page/runtime is reloaded or shut down is reconciled as failed/interrupted with code `TASK_INTERRUPTED` and `retryable: false`.
- Interrupted work is not automatically resumed. This preserves the safety boundary around microphone capture, network operations and side effects; it is not cross-device or server-side recovery.

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

This document records static source review plus the CI results recorded for the PR head at the time of each update. It does not claim a physical iPhone Safari session or a human-operated end-to-end playback session unless those are separately recorded with device, build and result.

## 6. Completion status and remaining acceptance

### Implemented and covered by current source/tests

| Capability | Current evidence | Status |
|---|---|---|
| Typed retry classification and bounded automatic retries | DagExecutionError, adapter HTTP/network classification, DAG retry tests | IMPLEMENTED |
| Explicit failed-step replay with fresh execution identity and dependency reuse | replayFailed, requestReplay, lineage and side-effect guards; DAG/runtime tests | IMPLEMENTED |
| Reload reconciliation | TaskRuntime.restoreAll records orphaned running/waiting tasks as non-retryable TASK_INTERRUPTED; runtime tests cover repeat restore | IMPLEMENTED |
| Candidate assessment completeness | Review checks unmatched, duplicate, orphan and incomplete candidate assessments; movie-agent tests cover invalid evidence | IMPLEMENTED |
| Per-item probe duration | /api/quality returns probeDurationMs; adapter forwards it; workflow/UI display it with an explicit semantic disclaimer | IMPLEMENTED |
| Real conversation-to-workflow wiring | data-movies -> useFridayChatSession.handleData -> runLibreTVMovieWorkflow; workflow and request-guard tests cover adjacent behavior | WIRED; hook-level browser integration not independently proven by these unit tests |
| Cancellation and request cleanup | Chat stop/unmount abort controllers; DAG, API route and request-guard tests cover cancellation behavior | IMPLEMENTED; physical browser timing still needs validation |

### Not implemented (intentionally out of current scope)

1. **Source-origin RTT / isolated network latency:** probeDurationMs is server-side per-item elapsed time, not source RTT. latencyMs is not measured. Add a separately defined metric only if product requirements still need it.
2. **Decoded playback resolution certification:** HLS/segment resolution is not the HTML video element's decoded videoHeight. This requires a real playback telemetry path and must not be inferred from source probes.
3. **Cross-device/server-side task persistence:** task history remains browser-local IndexedDB. A shared store requires explicit infrastructure, retention and privacy approval.
4. **General resume of interrupted work:** interrupted tasks are reconciled and displayed, not automatically resumed. This is a deliberate safety boundary for microphone, network and side-effect work.

### CI and manual acceptance gates

- The current PR head's applicable GitHub Actions workflow and Cloudflare Preview build must be checked by exact head SHA. Never carry forward a green result from an older commit.
- prelaunch-checks runs on pull requests to main. friday-2.2-verify has path filters for Friday/runtime/API code; a documentation-only PR does not trigger it. For code changes within its path filters, require its result as well.
- Required automated steps in the workflows are dependency installation, TypeScript, ESLint, unit tests and production build.
- A successful Cloudflare Workers Build check is a Preview build result, not a production deployment or a browser smoke test.
- **Still requires a human-operated physical-device pass:** iPhone Safari repeated microphone starts, permission denial/recovery, stop during ASR, stop during TTS, second-turn restart, homepage movie cards, detail modal, episode selection and actual playback. No physical iPhone test is claimed by this static audit or by CI.

The remaining items above are validation or explicitly out-of-scope capabilities, not a request to repeat V3.6–V3.14 implementation.

## 7. Branch hygiene

This audit branch is based on the audited `main` baseline recorded above. The historical `feature/friday-v3-runtime` branch is not the integration base and is left untouched. Re-check branch divergence from GitHub before using any commit-count statement; commit counts are intentionally omitted here because they change over time.