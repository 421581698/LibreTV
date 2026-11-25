# Friday Global Liquid Glass V1.2 — PR #99 acceptance contract

**Scope:** iPad Edition and shared desktop UI glass surfaces. Preserve application
layout, search, navigation, source management, media decoding and playback behavior.
**Branch:** `feature/libretv-ipad-edition-product`. Keep PR #99 Draft. No merge,
`main` write or production deployment.

## Implementation map

| Requirement | Current implementation | Evidence required before acceptance |
|---|---|---|
| Six materials | `runtime.ts`, `friday-glass.css`, `FridayGlassControls.tsx` | Same-background six-card screenshots, visible opacity/blur distinctions |
| iPad and desktop core | `LiquidGlassSurface`, `glass-system.css`, `friday-glass-v12.css` | iPad portrait/landscape/split and desktop screenshots |
| Theme | `FridayGlassProvider.tsx` reads app theme and saves system/light/dark | Cross-route theme switch and reload; no contrast regression |
| Navigation/drawer/search/dialog/player | iPad shell, search form/category, shared glass classes and ArtPlayer chrome | Interaction, accessibility and media-playback regression checks |
| Reflection/ambient/motion | Historical Friday Canvas2D restored as WebKit dock enhancement; CSS material lighting for other surfaces | Screenshot/film and reduced-motion inspection |
| Verifiable refraction | `refraction.ts` samples only a generated, owned background in Glass Lab | Nonzero pixel count on, zero pixel count off; identical source data |
| Safety/performance | reduced motion/transparency, forced-colors palette, playback/CPU-pressure native or safe fallback | Automated flag assertions, forced-colors inspection, playback frame checks |
| Automation | Vitest, `scripts/friday-glass-browser-audit.mjs`, existing Preview visual workflow | Exact-SHA CI success and browser artifact |
| Physical Safari | Not accessible to GitHub cloud CI | Signed-off evidence from real iPad Safari |

## Optical truth boundary

The Canvas2D reflection layer adds optical light, not arbitrary DOM refraction.
The source-aware pixel displacement in the Glass Lab is a real operation on
the known canvas source and measures changed pixels. It **does not** capture
the pixels behind unrelated HTML, DRM video or cross-origin content. On Safari
ordinary navigation uses transparent CSS backdrop sampling and a decorative
Canvas light layer. No native Apple Liquid Glass API is claimed.

## Physical iPad Safari acceptance

Record iPad model, iPadOS/Safari version, browser zoom and reduced-motion settings.
Open the isolated Preview (not Production). Record each check as pass/fail with
screenshots and interaction evidence:

1. At `/ipad-edition/glass-lab`, compare six materials over the same stripe
   background. Clear must be visibly more transparent than Frosted; Solid must
   be opaque. Test system, light and dark themes, then reload.
2. Toggle the controlled-background refraction. `changedPixels` must be
   positive with nonzero displacement and zero when disabled. Do not describe
   this as DOM backdrop refraction.
3. Visit home, search, category, library and settings. Open/close the drawer,
   change theme and material, navigate, use keyboard/touch and check legibility.
   Ensure no posters or media pixels are filtered by the material engine.
4. On a **real authorized media source**, verify play/pause, scrubbing/seek,
   source switching, subtitles, playback speed, quality, popups and orientation.
   Inspect dropped frames and confirm playback protection disables optical work.
   Synthetic fixtures alone do not prove real media playback.
5. Enable Reduce Motion, Reduce Transparency and high contrast / forced colors
   where supported. Confirm effects stop or downgrade, focus remains visible,
   and native input controls stay operable.
6. Verify desktop Chrome and Safari separately; compare candidate screenshots
   to prior Preview, including navigation geometry and layout shift.

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
and the exact-commit PR workflows must pass before marking CI accepted.
The Preview workflow executes Playwright audit after its CI gate.
TestSprite CLI remains an additional quality layer when configured; its run
must not be asserted without a saved report.

**Status:** code committed to PR #99; exact-SHA CI/Preview and physical
Safari acceptance must be recorded separately. No production acceptance
is implied by a GitHub commit or cloud browser pass.
