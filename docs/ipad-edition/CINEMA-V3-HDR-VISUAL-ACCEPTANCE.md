# LibreTV iPad Cinema V3 — media color and visual acceptance

Scope: PR #99 only; main and Production remain unchanged.

## Implemented in this batch

- Global iPad artwork presentation stylesheet for homepage backdrops, poster rails, anime/search/continue cards, details and video elements. Preserve source image/video pixels, natural color and gamut, and use separate local contrast overlays rather than global darkening.
- Enable Safari `dynamic-range-limit: no-limit` on iPad image/video elements when supported. This allows real HDR source content to be rendered natively where browser and display permit it, **but does not generate HDR from SDR**.
- Opt-in iPad artwork requests original HTTPS image bytes before proxies, then fall back to existing proxy candidates. This protects embedded gain maps and color profiles when direct image requests work. User-configured custom proxy remains authoritative.
- PosterRenderer passes explicit `hdrUrl` candidates through SmartImage (when metadata supplies one), preserving HDR-to-SDR fallback. A TMDB jpeg or ordinary anime poster is **not** labelled HDR. The `data-cinema-image-tier` attribute describes candidate selection, not measured display output.
- Detail layout retains provider-specific playback and identity, corrects typography, limits artwork sizing, uses ratio-safe logo selection, avoids repeated synopsis/credits rows, and measures actual overview overflow before showing "更多".
- Responsive landscape, portrait, and narrow viewport rules; reduced-motion and high-contrast support.

## Explicit technical boundaries

- A CSS media query or Safari playback capability is **not** evidence that pixels are HDR. There is no trusted source HDR manifest for every public TMDB/Bangumi image. Gain maps and original profiles must actually be present, and the browser/hardware must support them.
- Real HDR video requires a verified HDR asset plus appropriate HEVC/HLS/AV1 hardware decode, metadata processing and actual display output. The existing Dolby Vision diagnostic path remains independent and is not certified by these UI changes.
- Do not display Dolby Vision, Dolby Atmos, HDR10 or 4K badges solely on the basis of device capability or provider branding.
- Browser checks and simulated iPad Playwright screenshots do **not** replace physical iPad Safari SDR/HDR A/B testing with licensed HDR media.

## Release gates (remain outstanding until evidenced)

1. All five exact-head PR workflows pass, followed by isolated Cloudflare Preview deploy and screenshot audit.
2. Test homepage, browse, search, movie, TV, anime, library, detail and watch routes for brightness, readability, no overflow, and preserved interaction.
3. Test iPad Safari portrait/landscape/split view and native HDR vs SDR with *known-good* licensed images and streams; inspect physical output, device settings and color behavior.
4. EdgeOne GitHub Preview must be confirmed independently; readiness check alone is not deployment evidence.
5. Do not merge PR #99 or deploy Production without explicit authorization.

References:
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- https://developer.apple.com/videos/play/wwdc2025/233/
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/dynamic-range
