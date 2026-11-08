# Friday V3.5 — Workflow Reliability

## Version path

Friday proceeds from V3.2 directly to V3.4 and then V3.5. V3.3 remains skipped. V3.5 is additive to the merged V3.4 baseline and preserves the current gold holographic orb and its existing interaction path.

## Delivered scope

### 1. Safe workflow replay
- `TaskRuntime.getSnapshot` reads the persisted task state before execution.
- `runFridayDag({ replayFailed: true })` is an explicit replay path, not an automatic page-reload resume.
- Previously successful nodes are reused with their persisted output; their agents are not called again.
- Only failed nodes with an explicit persisted `retryable: true` error may replay.
- A dependent task is replayable only when its failed prerequisite was retryable.
- Running/waiting tasks cannot be replayed concurrently; cancelled and non-retryable tasks require a new execution identity.
- Side-effect tasks are never automatically or manually replayed.
- Automatic retry exhaustion preserves retryable status so the user can choose a later retry.
- Replay is bounded to four replay requests per task.

### 2. User-visible retry
- A “Retry failed steps” action appears only when the workflow contains failed tasks explicitly marked retryable.
- The action reuses the original task identity and event stream, preserving replay audit history and successful upstream outputs.
- The UI uses the existing Friday conversation and orb interaction; no separate page or HUD is introduced.
- Retry context is held in the active browser session. Reload does not silently restart a task.

### 3. Task lineage
- Movie workflow tasks persist parent-child links: optional parent request → search → source probe → quality assessment → review.
- Replays append to the same task event history rather than creating a misleading duplicate run.

### 4. Evidence-complete review
- Every search candidate must have exactly one matching assessment by stable candidate ID.
- Duplicate candidate IDs, duplicate assessments, assessments for unknown candidates, missing assessments and incomplete assessments are rejected.
- A detected resolution requires a positive finite height and the explicit HLS/segment resolution evidence marker.
- Assessment completion is separate from resolution measurement; advertised quality labels are never treated as measured values.

## Safety boundaries

- No automatic resume after reload, no microphone restart, and no side-effect replay.
- No retry for permanent errors, cancellation, or active tasks.
- Source probe duration remains server-side per-item duration, not source RTT or playback startup time.
- Existing search results, detail modal, player controls, API contracts, local history and selected orb design remain unchanged.

## CI acceptance

The release gate is both GitHub Actions workflows green on the final PR head:
1. `prelaunch-checks`
2. `friday-2.2-verify`

Each must complete TypeScript, ESLint, unit tests and production build. CI-green is the acceptance criterion. No production deployment or manual device validation is implied.

## Branch

- `feature/friday-v3.5-workflow-reliability-2026-11-08`
- Base: `main`
