# ASS/SSA subtitle integration

## Runtime

- Renderer: JASSUB 2.5.38 (libass compiled to WebAssembly; WebGL/WebGL2 with Canvas fallback).
- JASSUB is loaded lazily only after a user selects a local .ass or .ssa file.
- The worker entry is bundled locally by scripts/prepare-jassub-assets.mjs; WASM variants and the default font are copied into public/jassub/ at predev and prebuild.
- No runtime CDN dependency is used. queryFonts: false disables JASSUB's optional online font lookup.
- Local subtitle files are limited to 20 MiB in the PlayerShell.
- HLS and native browser subtitle tracks remain separate paths and do not require JASSUB.

## Browser and deployment requirements

JASSUB documents Safari 17+, WebAssembly, TextDecoder, OffscreenCanvas, Web Workers, Proxy, Fetch, Promise and requestVideoFrameCallback/getVideoPlaybackQuality requirements. SharedArrayBuffer and COOP/COEP headers enable its multithreaded mode; without cross-origin isolation it falls back to single-threaded rendering. LibreTV does not enable COOP/COEP globally as part of this integration because doing so could affect unrelated cross-origin media and embeds.

The renderer checks the required browser primitives before startup and reports an unsupported-browser error rather than silently claiming ASS support.

## Persistence boundaries

HLS/native subtitle track choice, enable state, font size and background opacity are stored per source and episode. ASS time offset is persisted and applied to the active JASSUB renderer; ASS font styling remains governed by the subtitle script. A local ASS/SSA file is currently session-scoped: its contents are not copied into localStorage and are not restored after a reload. Persisting user-provided subtitle files requires a separate IndexedDB quota/eviction policy and is not claimed complete.

## Licensing

JASSUB declares the composite license expression recorded in JASSUB-THIRD-PARTY-NOTICES.txt. The package's own MIT wrapper notice is copied beside the generated runtime assets; the upstream full notice for bundled components is retained in the repository. Review the exact distribution obligations before shipping a production release.

## Validation still required

- Run the production build and confirm the generated worker/WASM URLs return successfully in an isolated Preview.
- Verify ASS rendering, embedded fonts, style overrides, rotation and resize on iPhone Safari and iPad Safari.
- Measure memory and frame-time impact on low-memory iOS devices.
- Confirm cleanup on source change, PlayerShell close and page navigation.
