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

## P6 final status

The implementation items listed above were delivered and verified by the P6 CI run on commit `fe943970d9375f6b405b66460ffefe6caaac19d7`.

- Dexie event persistence, schema migration, spatial state, profile import/export, retention, payload bounds and persistence error reporting have automated coverage.
- The Intelligence workspace exposes read-only, redacted task audit summaries.
- CI passed TypeScript, ESLint, 840 unit tests and production build.
- Browser-native IndexedDB behavior, real Safari quota/private mode and multi-tab behavior remain device acceptance items; the fake IndexedDB suite does not claim to validate those environments.
- Profile transfer remains manual; Dexie writes are atomic within the database transaction, while localStorage settings are committed separately afterward.
- No cloud sync or automatic side-effect replay is provided.

## Explicitly out of scope

- No database replacement or server-side migration.
- No automatic cloud synchronization.
- No automatic replay of side effects after reload.
- No production deployment or merge to `main` as part of this audit.
