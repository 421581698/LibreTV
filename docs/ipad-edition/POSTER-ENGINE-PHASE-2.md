# Poster Engine — Phase 2 Rendering and iPad Adaptation

## Scope
Phase 2 adds one presentation layer over the Phase 1 PosterAsset and SmartImage contracts. It does not change provider discovery, artwork rights, original URLs, IndexedDB records, or image proxy security.

## Shared renderer
PosterRenderer owns frame geometry and variant semantics; SmartImage remains the only image-loading, decoding, and fallback path. Variants:
- poster: 2:3 artwork for home rails, collection pages, and the library.
- hero-poster: featured portrait artwork layered beside cinematic hero copy.
- backdrop: full-bleed landscape artwork behind the hero.
- anime: daily-anime artwork frame.
- result: search-result artwork.
- continue: 16:9 continue-watching artwork with progress and play overlays.

The renderer exposes provider, artwork-kind, and variant metadata as data attributes. It never rewrites source URLs or fabricates source identity.

## Layout rules
- Portrait source artwork keeps a 2:3 frame; object-fit crops display only and does not alter source pixels.
- A dedicated landscape backdrop frame prevents portrait posters being stretched across the hero.
- Tablet portrait uses four-column collection/search grids and a shorter hero.
- Tablet landscape uses five-column grids and a wider cinematic hero.
- Narrow split-view widths fall back to two-column collection/search grids; horizontal rails retain native scrolling.
- Frames use layout/paint containment; image decoding remains asynchronous.

## Accessibility and performance
- Descriptive alt text and native lazy/eager loading hints are retained.
- No continuous animation or per-poster backdrop blur is introduced.
- Hover zoom is limited to fine pointers; reduced-motion disables transitions.
- Reduced-transparency mode uses a solid fallback surface.
- Existing SmartImage HDR, candidate fallback, proxy, and placeholder behavior remains authoritative.

## Validation
CI must pass TypeScript, ESLint, unit tests, and production build. Preview validation must inspect home, movie/series/anime collections, search, library, and continue-watching at portrait, landscape, and narrow split-view widths. A real iPad Safari pass remains required; Chromium CI is not a substitute.
