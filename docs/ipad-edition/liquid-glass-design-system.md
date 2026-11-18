# iPad Edition Liquid Glass Design System

This specification governs the isolated LibreTV iPad Edition product branch.

## Navigation capsule

- Four icon-only entries, in order: sidebar, home, search, and personal space.
- One geometric panel icon for the sidebar; do not substitute a hamburger icon.
- A slim 58px desktop/tablet capsule with a 390px maximum width; compact screens use a 54px capsule capped at 360px.
- The outer shell uses a true pill radius (`999px`); the four inner icon targets use restrained Apple-like rounded corners (15px desktop/tablet, 14px compact).
- Consistent 21–22px icon scale and stroke weight, with 42–44px inner touch targets.
- Active route state is conveyed by a restrained inner glass highlight.

## Material

- Translucent layered fills, backdrop blur and saturation, fine edge highlights, and restrained ambient shadows.
- Light and dark themes use separate material tokens and maintain legibility.
- Press feedback is subtle and does not rely on glow effects.
- Respect `prefers-reduced-motion`.
- The material must not obscure poster artwork or video content.

## Shared component language

Apply the same material tokens and capsule geometry across the top navigation, sidebar navigation, search controls, category filters, collection tabs, pagination, form actions, and floating action surfaces. Compact controls use a full pill radius; larger category tiles and panels retain generous continuous Apple-like corners while sharing the same translucent material. New floating panels and menus should reuse these tokens rather than introducing unrelated glass treatments.

## Scope and validation

All implementation remains on `feature/libretv-ipad-edition-product`, based on the iPad Edition foundation branch. Preview deployment is isolated to the iPad Edition Preview Worker. No production deployment, main-branch change, or PR merge is authorized by this specification.

CI success and HTTP route checks are not substitutes for real iPad visual acceptance.


## Implementation notes

- Compact controls use a full capsule radius; category tiles and large panels retain larger continuous corners.
- Media artwork and video surfaces are intentionally excluded from global glass overlays.
- Use `-webkit-backdrop-filter` alongside `backdrop-filter` for Safari compatibility, with translucent fills remaining legible when blur is unavailable.
- Verify touch targets, safe-area placement, scrolling, and light/dark contrast on a real iPad after Preview deployment.
