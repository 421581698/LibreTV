# FRIDAY SPATIAL OS V4 — P5 Completion & P6 Persistence Log

Date: 2026-11-09
Branch: `feature/friday-spatial-os-v4`

## P5 — FMHY Resource Universe

- Replaced the 13 static external category links with an in-app category browser.
- Added a server route at `/api/fmhy` that reads only allow-listed Markdown files from the official `fmhy/edit` repository. It does not accept arbitrary upstream URLs, avoiding an open proxy / SSRF surface.
- Added full-catalog keyword search across the 13 category source documents, category browsing, title/domain/description matching, starred-first ranking, and an inline resource detail view.
- Resource detail records retain the canonical target URL and the upstream source document link.
- Upstream Markdown is cached through Next fetch revalidation (30 minutes). If FMHY is unavailable, the UI reports the upstream failure rather than showing stale or fabricated records.
- Added parser and API route tests for the 13-category taxonomy, safe link parsing, duplicate removal, category browsing, cross-category search, exact-match detail lookup, and rejection of unknown categories.
- The index follows the current official source repository. It is a live parsed catalog, not a fork or a locally mirrored copy of FMHY's full source data.

## P5 — Native unified favorites

- Added Dexie database version 6 with a `favorites` table.
- Favorite kinds: `fmhy-resource`, `media`, and `live`.
- FMHY resources can be starred from result cards and the detail view.
- Movie / TV recommendation cards now expose the same favorite action.
- Existing live-channel favorites are migrated idempotently from the legacy Zustand store into the unified collection.
- New live-channel favorite toggles now write through to the same Dexie collection while preserving the legacy Zustand field for backward compatibility.
- Removing a migrated live favorite also updates the legacy live-favorites list, preventing the next startup migration from restoring a removed item.
- Favorites are local to the current browser profile. No user data is uploaded by the favorite controls.

## P6 — Spatial state persistence

- Added Dexie `spatialState` table in database version 6.
- The selected V4 workspace is restored from `active-space` on startup and saved when it changes.
- Resource Universe category, query, and favorites filter are persisted separately under `resource-universe`.
- Existing Friday Task Runtime event streams remain in the existing local Dexie task event store. This change does not duplicate task ownership or replay side-effect tasks.
- Existing theme, source, and preference persistence remains in the Zustand/localStorage store.

## Cross-device personal profile

- Extended the existing LibreTV settings export/import format to version 3.
- The portable JSON profile contains app settings, viewing history, playback progress, unified favorites, and spatial state.
- Import validates favorite URLs as HTTP(S), caps imported favorites and progress records, and keeps compatibility with legacy viewing-history field names.
- The Identity workspace now exposes profile export and import. A user can transfer the JSON file to another device and import it there.
- This is explicit manual cross-device portability, **not automatic cloud sync**. The current server authentication is a shared password gate rather than individual user accounts, and this Worker configuration has no per-user durable profile database binding. Uploading all visitors' profile data under a shared session would mix private user data, so no unsafe shared cloud store was added.
- Friday conversation bodies and task event logs are deliberately excluded from the portable profile.

## Verification and acceptance boundary

- Parser unit tests, FMHY route tests, and homepage / P5 / P6 source-contract regression tests were added or extended.
- The final head SHA must pass TypeScript, ESLint, all unit tests, and Production Build before this batch is accepted.
- Preview deployment and browser interaction checks remain separate from CI.
- iPhone Safari physical-device acceptance remains separate from CI and Preview.
- No merge to `main`, no production deployment, and no production environment changes.
