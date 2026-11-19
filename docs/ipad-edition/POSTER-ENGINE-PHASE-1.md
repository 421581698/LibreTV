# Poster Engine — Phase 1 Foundation

This document records the source and asset contract introduced for the iPad Edition.
It does not change the existing page layouts or introduce the Phase 2 renderer.

## Ownership boundaries

- Providers supply real artwork URLs and provider identifiers.
- `PosterAsset` is LibreTV's source-neutral representation.
- `originalUrl` retains the exact supplied HTTP(S) URL; display candidates are resolved separately.
- Rights default to `unknown`. A reachable image is not evidence of permission to cache, redistribute, or transform it.
- `SmartImage` remains responsible for browser image loading, candidate fallback, HDR capability handling, and placeholder behavior.

## Current adapters

- `fromDoubanItem`: Douban recommendation cover.
- `fromBangumiItem`: Bangumi calendar cover.
- `fromCmsSearchResult`: CMS search result artwork.

The contract reserves provider identities for TMDB and other sources without claiming those providers are already connected to every iPad page.

## Image normalization

Measured width and height can be attached with `withPosterDimensions`.
Aspect classification is conservative: portrait, landscape, square, or unknown.
No image pixels are rewritten and no dimensions are fabricated when the source does not provide them.

## Image candidate safety

Douban-specific high-resolution path upgrades and mirror candidates are limited to HTTPS hosts matching `imgN.doubanio.com`.
Other providers retain their original URL and the existing site proxy fallback; their URL paths are not rewritten as if they were Douban assets.

## Proxy cache policy

Only successful image responses whose final upstream host remains in the explicit anonymous-image allowlist receive a shared 30-day cache.
Failed responses are `no-store`; image responses outside that public allowlist use a private short cache.
The existing SSRF validation and per-redirect validation remain in place.

## Not part of Phase 1

- Poster layout, crop, typography, backdrop effects, or theme selection.
- iPad portrait/landscape layout changes.
- New third-party image scraping or unverified rights assumptions.
- Changes to production, `main`, or other LibreTV editions.
