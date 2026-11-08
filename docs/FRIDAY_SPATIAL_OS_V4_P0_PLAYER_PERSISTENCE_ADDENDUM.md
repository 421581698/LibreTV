# V4 P0 Audit Addendum — Player and Persistence Evidence

This addendum extends `FRIDAY_SPATIAL_OS_V4_P0_COMPATIBILITY_AUDIT.md` with the exact player and database paths verified after the initial pass.

## Player path verified

- Playback route: `src/app/watch/page.tsx` (URL-driven `/watch?source=...&id=...&index=...`).
- Player component: `src/components/player-shell.tsx`.
- Engine: ArtPlayer + hls.js; dynamically imported by the watch page with SSR disabled.
- The ArtPlayer instance is created once and source changes are handled without destroying/recreating the instance, preserving fullscreen context and avoiding video-element recreation races.
- Existing player contract includes time/progress, pause/end, previous/next episode, source recovery/switch, skip-mark segments, download integration, and Friday player commands.
- Subtitles/source switching/fullscreen controls are owned by the existing player implementation; V4 must wrap the player page layout rather than replace the player engine.
- Real decoded height is read from `art.video.videoHeight` and sampled on `video:loadedmetadata`, `video:canplay`, native `resize`, and `video:playing`. The callback is `onQuality(height)`; this is actual decoded video evidence, not manifest metadata.
- `src/app/watch/page.tsx` is the page-level owner for source, episode, history, progress and player state. `PlayerShell` is the playback engine boundary.

## Database and persistence path verified

- Database: `src/lib/db.ts`, Dexie database name `libretv`.
- Existing tables include viewing history, progress, search history, live probe, segment metadata, download tasks and Friday task events.
- Friday task event table was added in DB version 4 and indexed further in version 5:
  `eventId, taskId, [taskId+sequence], occurredAt, type, [type+occurredAt]`.
- Task events are browser-local IndexedDB records. They are not cloud-synced and should not be represented as cross-device persistence.
- Friday conversation history is a separate bounded local serialization contract in `src/lib/friday/conversation-history.ts`: max 30 messages, 2,000 characters per text part, 30-day age limit, versioned payload. The storage caller is in the Friday session hook and must be kept separate from task event persistence.

## Updated decision

| Area | V4 decision |
|---|---|
| Player | **Keep ArtPlayer + hls.js and the watch page. Rebuild only responsive layout and auxiliary UI.** |
| Decoded quality | **Keep actual videoHeight sampling and existing feedback event path.** |
| Playback state | **Keep current IndexedDB history/progress contract. Do not migrate or rename tables in the UI-only pass.** |
| Task history | **Keep Dexie event store; disclose browser-local scope.** |
| Conversation history | **Keep versioned, bounded history; do not merge it into the task event log.** |

## Remaining non-blocking checks

- Run the existing test suite and CI on the V4 branch after the first implementation slice.
- Browser-test ArtPlayer control hit areas, subtitle safe area, fullscreen and source drawer at desktop, iPad and iPhone widths.
- Confirm whether any user expectation requires cross-device task/session sync; current source evidence does not provide it.
