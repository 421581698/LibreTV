# iPad Edition Liquid Glass Design System

This specification governs the isolated LibreTV iPad Edition product branch.

## Navigation capsule

- Four icon-only entries, in order: sidebar, home, search, and personal space.
- One geometric panel icon for the sidebar; do not substitute a hamburger icon.
- A 72px desktop/tablet capsule with a 430px maximum width, adaptive on compact screens.
- Consistent icon scale, stroke weight, and minimum 48px interaction targets.
- Active route state is conveyed by a restrained inner glass highlight.

## Material

- Translucent layered fills, backdrop blur and saturation, fine edge highlights, and restrained ambient shadows.
- Light and dark themes use separate material tokens and maintain legibility.
- Press feedback is subtle and does not rely on glow effects.
- Respect `prefers-reduced-motion`.
- The material must not obscure poster artwork or video content.

## Shared component language

Apply the same material tokens to the top navigation, sidebar, backdrop, search surfaces, category controls, pagination, and floating action surfaces. New floating panels and menus should reuse these tokens rather than introducing unrelated glass treatments.

## Scope and validation

All implementation remains on `feature/libretv-ipad-edition-product`, based on the iPad Edition foundation branch. Preview deployment is isolated to the iPad Edition Preview Worker. No production deployment, main-branch change, or PR merge is authorized by this specification.

CI success and HTTP route checks are not substitutes for real iPad visual acceptance.
