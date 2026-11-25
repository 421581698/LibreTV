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

## Design Engine integration

The six-pillar system is defined in [IPAD-DESIGN-ENGINE-ROADMAP.md](./IPAD-DESIGN-ENGINE-ROADMAP.md). This Liquid Glass document remains the material-specific reference; it must follow the shared material, motion, spatial, accessibility, and performance tokens defined by that roadmap.

Safari baseline: translucent fill, backdrop blur where available, edge contrast, highlight and shadow. SVG displacement/refraction and chromatic aberration are optional progressive enhancements only. A missing displacement filter must never make the navigation or controls unreadable.

Preview rollout: [deploy-ipad-edition-preview]

## Friday Global Liquid Glass V1.1

The root provider reuses the existing light, dark and system theme settings.
Friday rendering preferences have their own storage key. The environment examples
in appearance settings keep their selection in the current view only.

| Surface | Material |
| --- | --- |
| Shared navigation and controls | Regular |
| Actions over artwork | Clear |
| Panels, dialogs and appearance settings | Frosted |
| Watch controls | Cinema |
| Surfaces with a known background tone | Ambient |
| Reduced transparency, explicit solid mode or renderer failure | Solid |

On supported Chromium clients, larger shared surfaces can use the locked
`liquid-glass-react@1.1.1` adapter. WebKit uses bounded CSS blur and an
inset edge highlight. Other browsers use native CSS or solid fill based on
capability. Chromium Auto quality backs off after clustered long tasks and
recovers after a quiet period. A renderer error affects the decorative
layer and selects solid fallback. Friday attempts one recovery after 30 seconds
before retaining solid fallback for the session.

Watch controls read existing playback state. Protected playback and hidden
controls suppress control backdrop filtering. Player input handlers, video
frames and decoding are outside the appearance pipeline. Local ambient tones
come from known backgrounds or explicit surface metadata.

The iPad navigation capsule uses one decorative highlight that moves between
native navigation targets. Reduced Motion disables the transition. The same
material tokens cover shared dialogs, menus, dock, desktop search, iPad search
and collection controls, artwork actions, and the cinema toolbars.

The Preview workflow runs `scripts/friday-glass-browser-audit.mjs` against the
isolated Worker. It checks light and dark settings at four viewport sizes,
settings CLS, solid ambient text contrast, persistence, and capsule animation.
For a local playback comparison, supply `FRIDAY_MEDIA_FIXTURE` (an at least
four-second WebM clip) and `FRIDAY_BASELINE_URL`; the audit plays the same bytes
through the standard watch route and compares decoded and dropped frames.

Release acceptance still requires TestSprite service credentials and physical
iPhone/iPad Safari. The controlled WebM exercise measures Chromium playback
independently of external sources. Device checks should include dragging the
seek bar in both orientations, playing and pausing, opening the quality menu,
reduced motion, and the visible glass fallback on Safari.
