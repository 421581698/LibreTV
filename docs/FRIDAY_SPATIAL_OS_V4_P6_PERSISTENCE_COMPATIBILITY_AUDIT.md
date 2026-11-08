# FRIDAY SPATIAL OS V4 — P6 Persistence Compatibility Audit

Date: 2026-11-09
Branch: `feature/friday-spatial-os-v4`
Baseline: P5 head `ab290534a6640e66590333e9658255158f566c58`

## Purpose

P6 must harden the existing persistence boundaries and recovery behavior. It must not replace Dexie, Task Runtime, the current Friday conversation store, or the existing playback history/progress services with a second persistence system.

This document records source-level findings. It is not a claim that P6 implementation or runtime acceptance is complete.

## Existing persistence surfaces verified in source

| Data | Existing owner / storage | Current behavior |
|---|---|---|
| Active spatial workspace | `readSpatialState` / `writeSpatialState` in `src/lib/db.ts`; Dexie `spatialState` table | Home page restores `active-space`, validates it with `isSpatialSpace`, and writes after restoration |
| Favorites | Dexie `favorites` table and helpers in `src/lib/db.ts` | Supports media, live and FMHY resource records; Identity lists and removes records |
| Friday task audit | `TaskRuntime` + `DexieTaskEventStore`; Dexie `fridayTaskEvents` | Append-only events, contiguous per-task sequence validation, recent restore reader capped to 50 task-created events |
| Friday conversation history | Existing assistant-scoped localStorage implementation | Kept separate from task events; bounded history and payload filtering are owned by the existing chat-session layer |
| Viewing history | Dexie `history` table | Existing playback history service; bounded to `MAX_HISTORY` |
| Playback progress | Dexie `progress` table | Separate per-source / video / episode progress keys |
| Profile transfer | `exportConfig` / `importConfig` in `src/lib/db.ts` | Includes settings, favorites, spatial state, viewing history and playback progress; excludes Friday conversation bodies and task event logs |

## Existing safeguards

- Dexie schema is versioned through v6; v4/v5 add Friday task events and the recent-task index, while v6 adds favorites and spatial state.
- Task event append uses a read-write Dexie transaction, checks duplicate event IDs and task sequence keys, and enforces contiguous sequence numbers.
- Task Runtime validates event stream sequence and IDs before reconstructing a snapshot.
- Interrupted running/waiting tasks are reconciled as interrupted failures. Side-effect tasks are not automatically replayed.
- Spatial workspace restore rejects unknown values and falls back to the Cinematic space.
- Profile import validates the profile envelope and filters favorite URLs and imported record shapes before writing.

## P6 implementation delivered in this branch

- Added `fake-indexeddb` test support and IndexedDB-backed tests for task event append/read ordering, duplicate IDs and sequence keys, contiguous sequencing, concurrent same-sequence writes, recent-task cap, deletion, interrupted-task reconciliation, and explicit side-effect replay blocking.
- Added an actual v3-to-v6 Dexie upgrade test that seeds a legacy viewing-history row and verifies it survives the schema upgrade while the Friday event, favorites and spatial-state tables are introduced.
- Added spatial preference read/write/overwrite tests.
- Made profile import parse all supplied JSON sections before mutation and execute favorites, spatial state, history and progress writes in one Dexie read-write transaction. Browser `localStorage` settings are committed after the IndexedDB transaction; these two browser storage engines cannot participate in one atomic transaction, and a localStorage failure is surfaced to the caller.
- Added profile export/import round-trip, unsafe favorite URL filtering, malformed-section no-partial-write tests. Friday task event logs and conversation bodies remain excluded from profile export.
- Added explicit `pruneTerminalTasks(cutoff, keepRecentTaskCount)` maintenance. It only removes old terminal streams, never active tasks, and protects the newest requested number of task-created records. It is opt-in and is not silently run during restore.
- Enforced a 256 KiB serialized event limit before task event writes; event payloads remain browser-local and are not included in portable profile export.
- Added `getLastPersistError()` and the `libretv:persistence-error` event for throttled localStorage write failures instead of silently swallowing quota/security errors. Dexie write failures continue to reject to their callers.
- Added a read-only task audit summary API and an Intelligence workspace panel. It shows recent task ID, agent, status, timestamps, event count, side-effect flag and error code only; it never renders task input, prompt, output or raw event payload.
- Added tests for localStorage quota error reporting and error clearing after a successful write.

## Remaining operational boundaries

- The IndexedDB suite uses `fake-indexeddb`, a standards-oriented in-memory implementation of the IndexedDB API. It validates Dexie transaction and schema behavior in CI, but it is not a substitute for real browser storage quota, eviction, Safari private-mode or multi-process device testing. Concurrent writes are tested against the same IndexedDB database connection; actual multi-tab Safari behavior remains part of device acceptance.
- Profile transfer is manual JSON export/import; there is no cloud sync. The Dexie portion is atomic across its four tables; the separate localStorage settings write follows after the Dexie commit.
- Retention is an explicit maintenance API; no automatic deletion policy is enabled until product-level retention settings are chosen.
- No automatic replay of side effects after reload.

## P6 gaps to resolve, in priority order

### P6.1 — Persistence contract and tests

- Add focused tests for `spatialState` read/write, unknown values, profile round-trip, and Dexie schema migration behavior.
- Add real IndexedDB-backed tests for `DexieTaskEventStore` (transactional append, duplicate IDs/sequences, contiguous sequence enforcement, ordering and recent-task cap). Current Task Runtime unit tests primarily use an in-memory store and do not prove browser IndexedDB behavior.
- Verify profile import behavior when individual stores fail; the current importer performs multiple store writes and should not be described as one atomic cross-store transaction.

### P6.2 — Task recovery and audit UX

- Verify restore behavior across reloads and multiple tabs using the real Dexie store.
- Preserve the rule that a restored task is an audit/recovery candidate, not permission to replay side effects.
- Make persisted task outcomes inspectable from the Intelligence workspace without creating a parallel task store or exposing raw sensitive payloads by default.
- Define explicit user-triggered retry behavior for retryable read-only tasks; never silently replay playback, download, or other side-effect tasks.

### P6.3 — Storage lifecycle and privacy

- Define bounded retention/cleanup for old task event streams and stale spatial state entries without deleting active or diagnostically useful records.
- Review what task event payloads may contain and establish a redaction/size policy before adding broader export or UI exposure.
- Keep Friday conversation and task event logs out of portable profile export unless a separate explicit, user-consented export design is approved.
- Surface IndexedDB unavailable/quota failures instead of silently implying that a preference was saved.

### P6.4 — Cross-device and multi-tab semantics

- Keep profile transfer as explicit user-managed export/import; no cloud sync is implied.
- Define merge-versus-replace behavior for imported favorites, settings and spatial preferences.
- Add concurrency tests for same-task event append and concurrent workspace preference writes where appropriate.

## P6 completion gates

1. Persistence tests exercise Dexie behavior over an IndexedDB implementation, including schema migration and transaction semantics; real Safari/device storage remains a separate acceptance item.
2. Import/export behavior and failure semantics are documented and covered by tests, including the IndexedDB/localStorage atomicity boundary.
3. Task recovery is tested without automatic side-effect replay.
4. Retention, payload size, privacy and storage failure behavior have explicit contracts and tests.
5. TypeScript, ESLint, unit tests and production build pass on the latest P6 branch head.
6. Preview and iPhone Safari validation are reported separately from CI.

## Explicitly out of scope

- No database replacement or server-side migration.
- No automatic cloud synchronization.
- No automatic replay of side effects after reload.
- No production deployment or merge to `main` as part of this audit.
