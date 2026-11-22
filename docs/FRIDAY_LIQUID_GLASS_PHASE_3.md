# Friday Liquid Glass — Phase 3 page integration

## Goal

Move real LibreTV page surfaces onto the canonical Friday material system without changing route behavior, data flow, player behavior, or page layout.

## Integrated in the first migration slice

- Legacy `GlassPanel`, `GlassToolbar`, `GlassPopover`, and `GlassDialog` now delegate to the Friday `panel` / `bar` material primitives.
- Legacy `GlassButton` delegates its surface to the Friday `control` material while preserving the native button as the interactive element.
- The shared mobile tab bar uses `GlassDock` and keeps its semantic `nav` landmark.
- The general site header and cinema homepage header use `GlassBar` as their native `header` landmark.
- Search history dropdown heading uses `GlassBar` while preserving its listbox and keyboard interaction.
- Detail modal uses the `GlassDialog` compatibility primitive, preserving its focus trap, Escape/backdrop close behavior, and dialog labeling.
- Live channel filters and tool strips use the canonical panel material.
- Live EPG current-program panel uses `GlassPanel`; upcoming program rows use `GlassCard` with native `li` semantics.
- Aggregated search cards, single-source result cards, and Douban recommendation cards use `GlassCard` without changing their existing keyboard, favorite, lazy-image, or playback-selection behavior.
- Resource Studio uses `GlassBar` for its page header and `GlassCard` / `GlassPanel` for its status cards and task sections.
- Search results heading uses `GlassBar` while preserving the existing result stream and navigation.
- Settings drawer uses `GlassBar` for both index/detail headers and `GlassPanel` for the appearance section; settings persistence and panel routing remain unchanged.
- The shared dropdown overlay uses the Friday popover primitive.
- Destructive confirmation dialogs use the Friday panel primitive while retaining `role="alertdialog"`.
- Shared drawers already use the legacy `GlassPanel` API, so they inherit the Friday panel material without changing their focus, scroll-lock, or dismissal lifecycle.
- Friday glass primitives accept an explicit semantic host via `as`, so navigation and other landmarks are not flattened to generic divs.

## Compatibility and safety constraints

- Keep existing class names and public exports so current call sites remain compatible.
- Keep real buttons, links, form controls, and navigation landmarks semantic and keyboard-operable.
- Keep decorative optical layers non-interactive and behind content.
- Do not apply blur or optical overlays to video frames, poster artwork, or media canvases.
- Preserve reduced-motion, reduced-transparency, coarse-pointer, and low-power fallbacks.
- This slice is an incremental shared-surface migration, not a claim that every page has completed visual acceptance.

## Additional page integration on the Phase 3 branch

- Homepage poster rails now use `GlassCard` as the semantic button surface; `SmartImage` poster artwork remains foreground content and is not blurred.
- Detail hero back and favorite controls use `GlassControl`; episode cards use `GlassCard`. The primary play and share actions retain their existing native button behavior.
- Personal space uses `GlassBar` for its heading and `GlassPanel` for the continue-watching, media-library, and utility sections.
- Settings download management uses `GlassPanel` without changing download task actions.
- Live channel information, EPG, and channel-list sidebar use `GlassPanel`. The LivePlayer video frame remains outside all glass surfaces.
- The ArtPlayer `PlayerShell` was source-audited: it contains no Friday glass primitive or backdrop-filter styling. The video/media surface and its playback lifecycle remain untouched.
- The Phase 3 verification workflow now includes a Playwright Chromium route smoke across desktop, iPhone-sized, and iPad-sized viewport emulation. These are browser-emulated layouts, not physical Safari acceptance.

## Remaining Phase 3 work

- Extend deterministic interaction coverage for actual detail playback, episode selection, live channel switching, and settings persistence.
- Verify the independent Netlify Preview visually and check responsive behavior against the real deployment.
- Complete physical iPhone Safari and iPad Safari acceptance; Chromium viewport emulation must not be reported as device acceptance.
- Run Lighthouse/mobile performance checks and record results before calling the phase complete.
