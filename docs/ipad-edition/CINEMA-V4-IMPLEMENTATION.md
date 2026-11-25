# LibreTV Cinema V4.0 — PR #99 implementation contract

Scope: **only** `/ipad-edition/watch` on the existing `feature/libretv-ipad-edition-product` branch. PR #99 remains Draft. Do not merge or deploy production.

## Product / layout

- Cinema-first black canvas with natural video aspect ratio (`object-fit: contain`); no video filters or artificial HDR enhancements.
- One page-owned center transport: backwards 10s, play/pause, forwards 10s.
- Thin neutral progress line with media-clock timestamps; scrubbing commits on release, preserving existing restore and media lifecycle.
- Minimal top rail for back, name, fullscreen, AirPlay (when available), and media details.
- One bottom function rail: rate, lock, episodic list (only when multiple episodes), audio/subtitles, quality, source selection, diagnostics, fullscreen.
- All controls auto-hide during playing; stay accessible when paused, scrubbed, or a sheet is open. The lock mode provides a persistent unlock affordance.
- Source and episodes continue to use the existing authenticated and identity-safe page logic.
- Responsive landscape/portrait/split-window, safe-area-aware; keyboard focus and reduced-motion/reduced-transparency fallbacks.
- Friday glass is **restricted to open settings sheets**; never blur the video surface or draw giant pill controls.

## Architecture decisions

- `src/app/watch/page.tsx` remains the source of transport events and owner of media time, panels and source navigation.
- `src/components/player-shell.tsx` retains the single ArtPlayer instance, HLS/MP4/WebM loaders, source-fallback, skip engine, playback telemetry, progress and trusted media diagnostics.
- The optional `cinemaMode` prop removes duplicate ArtPlayer controls **only on the iPad route**. Legacy `/watch` still renders normal controls.
- `cinemaPanel` gates the existing HLS audio and quality interfaces, presents available native text tracks, and shows the pre-existing read-only Dolby Vision evidence inspector in a dedicated sheet.
- Cinema V4 layout CSS is imported solely from `src/app/ipad-edition/layout.tsx`; the main/global website layout and data contracts are unchanged.
- Control policy has dedicated Vitest coverage in `src/lib/cinema-v4-controls.test.ts`.

## Explicit capability boundaries

- **Dolby Vision**: a declared codec is not verified RPU, native Dolby decode or physical HDR display output. Preserve registry/Ed25519 evidence and identity checks.
- **Dolby Atmos**: do not claim JOC/object-audio decoding, rendering or actual iPad/AirPods/HDMI output from codec names, HLS audio descriptions or browser hints. No licensed Dolby Atmos renderer/verified physical output has been integrated in this UI batch.
- **Audio**: the existing hls.js track selector works only if selectable tracks are exposed by that playback path. Safari native HLS may not expose them.
- **Subtitles**: browser `TextTrackList` tracks are selectable where exposed; independent ASS/SSA rendering still belongs to the existing playback subsystem and may not be listed as a native track.
- **Brightness**: webpage JavaScript cannot promise control of physical iPad display brightness; deliberately do not create a non-functional brightness slider.
- **4K**: a user's quality preference or playlist declaration is not verified decoded 4K.

## Acceptance matrix

| Test | Required result | Source of evidence |
| --- | --- | --- |
| TypeScript and lint | No errors | Latest PR HEAD GitHub Actions |
| Unit tests | All tests including Cinema V4 policy pass | Latest PR HEAD GitHub Actions |
| Next.js build | Successful build | Latest PR HEAD GitHub Actions |
| iPad landscape/portrait/split-view | No overlap, clipping or orphaned controls | iPad device review / screenshots |
| Playback and seek | Real media play/pause/seek stable, including after source switching | iPad Safari manual acceptance |
| Audio and subtitles | Available tracks switch reliably and persist according to existing contracts | Real source and device evidence |
| Source panel / episode panel | Open/close, scrim and navigation do not alter playing item unexpectedly | Browser + iPad Safari |
| Dolby Vision/Atmos output | Separately validated codec, decoder, renderer, device output | Real authorized Dolby media and devices |

Do **not** describe static-code inspection or Chrome/WebKit desktop tests as real iPad Safari acceptance. Preview deploys, main changes and production deploys are out of scope without explicit authorization.
