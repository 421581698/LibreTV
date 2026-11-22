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

## Remaining Phase 3 work

- Continue page-local glass migration in homepage content rails, detail hero controls, the remaining settings subpanels, personal space, and remaining live route chrome.
- Audit the player chrome separately; never glass the video surface itself.
- Add route-level interaction and responsive regression coverage.
- Verify independent desktop, iPhone Safari, and iPad Safari layouts before calling the phase complete.
