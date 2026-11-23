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
- `fromCmsArtwork` / `fromCmsSearchResult`: CMS search, saved artwork, and detail-page artwork.
- `fromEpisodeArtwork`: preserves TMDB episode-still provenance only when a real TMDB episode/series-season-episode identity is available; it does not invent one.

The contract reserves provider identities for TMDB and other sources without claiming those providers are already connected to every iPad page.

## Runtime integration

The source-neutral contract is passed through the existing `SmartImage` entry point on the iPad product surfaces without changing the renderer or image-candidate policy:

- Douban: iPad home hero/poster rails, movie and series collections, and existing recommendation cards.
- Bangumi: the home daily-anime rail and anime collection route use the Bangumi provider namespace.
- CMS: iPad search results, video cards, movie details/backdrops, CMS episode stills, saved library items, and continue-watching cards use stable source/video identities.
- TMDB: explicitly attributed episode stills retain TMDB identity; records without sufficient TMDB identity remain unclassified rather than receiving a guessed provider ID.
- Stored favorites and watch history are adapted at render time; their existing IndexedDB records and schemas are unchanged.

`SmartImage` reads the asset's untouched `originalUrl` as its source while retaining its existing HDR, fallback, proxy, and placeholder behavior. Backdrops and episode stills carry their own artwork kind so they are not mislabeled as posters.

## Image normalization

Measured width and height can be attached with `withPosterDimensions`.
Aspect classification is conservative: portrait, landscape, square, or unknown.
No image pixels are rewritten and no dimensions are fabricated when the source does not provide them.

## Image candidate safety

Douban-specific high-resolution path upgrades and mirror candidates are limited to HTTPS hosts matching `imgN.doubanio.com`.
Other providers retain their original URL and the existing site proxy fallback; their URL paths are not rewritten as if they were Douban assets.

## Proxy cache policy

Only HTTP 200 image responses whose final upstream URL is HTTPS and whose host remains in the explicit anonymous-image allowlist receive a 30-day **browser-private** cache. No shared CDN cache is used while image rights remain `unknown`.
Failed and partial responses are `no-store`; image responses outside that host allowlist use a private short cache.
The existing SSRF validation and per-redirect validation remain in place.

## Not part of Phase 1

- Poster layout, crop, typography, backdrop effects, or theme selection.
- iPad portrait/landscape layout changes.
- New third-party image scraping or unverified rights assumptions.
- Changes to production, `main`, or other LibreTV editions.
