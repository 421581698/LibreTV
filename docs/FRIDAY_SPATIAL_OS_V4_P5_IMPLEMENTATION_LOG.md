# FRIDAY SPATIAL OS V4 — P5 Space Integration Log

Date: 2026-11-09
Branch: `feature/friday-spatial-os-v4`

## P5 scope

Connect the four V4 spaces to existing capabilities where they exist. Do not fabricate missing user data, duplicate runtime ownership, or claim an external resource catalog is a native LibreTV database.

## Cinematic

- Continues to render the existing LibreTV homepage, real recommendation services, search, detail flow and poster data.
- The existing live route remains available through the established navigation.

## Intelligence

- Added a dedicated Intelligence workspace entry surface.
- Its action opens the existing Friday panel through `friday-home-open-panel`; this opens the existing panel and does not start the microphone.
- Describes the existing movie Agent workflow, Task Runtime and voice pipeline without creating duplicate instances.
- The compact global `SpatialFridayEntry` remains the single persistent Friday entry point; the Intelligence page does not add a second orb.

## Resource Universe

- Added all 13 categories from the current official FMHY sitemap with source-language titles and verified official category URLs.
- Category cards open the canonical FMHY pages in a new tab. The source sitemap is linked from the workspace.
- The FMHY directory remains upstream: LibreTV does not mirror the external directory's resource records or claim native FMHY search/detail support.
- The local favorites store supports resource entries, but category navigation itself is not automatically treated as a favorite.

## Identity

- Added workspace actions for viewing history and source management, dispatching events to the existing Header-owned drawers.
- Added an entry to the existing Friday panel for assistant/voice/session preferences.
- Theme switching remains in the existing global header to avoid duplicate theme controls.
- Added a local favorites list backed by the existing Dexie `favorites` table, with removal and refresh behavior.
- Added portable profile export/import for settings, favorites, spatial state, viewing history and playback progress. The user carries the JSON file between devices; this is not cloud sync.
- Friday conversation bodies and task event logs are intentionally excluded from profile export/import.

## Persistence and ownership

- Viewing history and playback progress remain in their existing IndexedDB tables.
- Friday task audit events remain in the existing `fridayTaskEvents` IndexedDB table and Task Runtime.
- Friday conversation history remains in its existing assistant-scoped local storage.
- Active spatial workspace is restored from and written to the existing `spatialState` table through `readSpatialState` / `writeSpatialState`.
- Favorites use the existing `favorites` table.
- P5 connects the existing persistence surfaces; it does not merge them into one database model or move ownership out of their existing services.

## Acceptance boundary

- Latest P5 head `ab290534a6640e66590333e9658255158f566c58` passed GitHub Actions run [42498032106](https://github.com/421581698/LibreTV/actions/runs/42498032106): dependency install, TypeScript, ESLint, unit tests and production build.
- This CI result is not Preview/browser visual acceptance or iPhone Safari device acceptance.
- No merge to `main` and no production deployment.
