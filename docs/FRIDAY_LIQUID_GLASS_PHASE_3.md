# Friday Liquid Glass — Phase 3 page integration

## Goal

Move real LibreTV page surfaces onto the canonical Friday material system without changing route behavior, data flow, player behavior, or page layout.

## Integrated in the first migration slice

- Legacy `GlassPanel`, `GlassToolbar`, `GlassPopover`, and `GlassDialog` now delegate to the Friday `panel` / `bar` material primitives.
- Legacy `GlassButton` delegates its surface to the Friday `control` material while preserving the native button as the interactive element.
- The shared mobile tab bar uses `GlassDock` and keeps its semantic `nav` landmark.
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

- Audit and migrate page-local glass surfaces in homepage, search, detail, settings, personal space, resource studio, and live routes.
- Audit the player chrome separately; never glass the video surface itself.
- Add route-level interaction and responsive regression coverage.
- Verify independent desktop, iPhone Safari, and iPad Safari layouts before calling the phase complete.
