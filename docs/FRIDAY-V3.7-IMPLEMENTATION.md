# Friday V3.7 — DAG and Lineage Integrity

## Version path

Friday continues from V3.5 through V3.6 and V3.7. V3.3 remains skipped. V3.7 is additive to V3.6 and preserves the selected gold holographic orb, existing voice entry, chat flow, movie search, detail modal, and player contracts.

## Delivered scope

- Reject duplicate dependency edges before executing or persisting a graph.
- Validate dependency and parent task identifiers against the runtime's safe identifier contract.
- Reject a task that names itself as its parent.
- Detect cycles in parent lineage when the referenced parent is another task in the same graph.
- Permit an external parent request ID, because it may intentionally refer to a request outside the current DAG.
- Reject duplicate or empty Agent registrations instead of silently shadowing an Agent in a Map.
- Keep execution dependencies (`dependsOn`) separate from lineage metadata (`parentTaskId`).

## Safety boundaries

- Graph validation runs before task creation and Agent execution.
- Parent lineage remains audit metadata and does not implicitly create execution dependencies.
- No changes to voice capture, TTS, the gold orb renderer, movie search, player controls, API contracts, or deployment configuration.
- No preview or production deployment is part of this version.

## CI acceptance

Both `prelaunch-checks` and `friday-2.2-verify` must pass on the final PR head, including TypeScript, ESLint, unit tests, and production build.
