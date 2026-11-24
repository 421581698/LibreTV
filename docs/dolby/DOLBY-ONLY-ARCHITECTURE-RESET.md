# Dolby-only audio architecture reset

- Date: 2026-11-24
- Branch: `feature/libretv-ipad-edition-product`
- PR: #99 (Draft; do not merge)
- Status: legacy generic spatial presentation retired; Dolby-only implementation is the active product direction.

## Product boundary

LibreTV audio is Dolby-only. Do not ship generic stereo virtualization, generic Ambisonics, IAMF, DTS, or non-Dolby spatial-rendering modes as product features.

The product must distinguish:
1. **Detected** — Dolby codec or JOC metadata was declared by the media source.
2. **Decoded** — a real, supported Dolby decoder successfully decoded the selected stream.
3. **Rendered** — a verified Dolby Atmos/object-rendering path processed the decoded content.
4. **Output verified** — a named device and output chain passed physical acceptance.

A metadata marker, codec string, channel count, Web Audio availability, or browser `canPlayType()` hint cannot advance these states.

## Retired implementation

The following generic spatial implementation was removed from the player branch:
- `src/lib/spatial-audio.ts` and its unit tests
- `src/lib/spatial-media-session.ts` and its lifecycle tests
- `scripts/spatial-audio-browser-smoke.mjs`
- `scripts/spatial-hls-resource-cors-smoke.mjs`
- The player-shell independent spatial-session toggle and duplicate-media playback path

This removes the generic HRTF stereo-virtualization route and its duplicate media element. It does not claim to replace it with a Dolby decoder; no Dolby JOC/Atmos decoder or verified passthrough path is currently integrated.

## Retained playback infrastructure

Keep these existing foundations:
- ArtPlayer and the original HTMLMediaElement playback path
- hls.js / MSE and Safari native-HLS playback
- Direct MP4/WebM playback and native fallback
- HLS audio-track discovery and selection
- Dolby codec/JOC metadata inspection and read-only diagnostics
- Playback recovery, source switching, buffering and lifecycle management

Do not attach Web Audio to the reusable native player element as a workaround.

## Dolby-only implementation sequence

1. **Dolby format policy:** identify AC-3, E-AC-3, E-AC-3 JOC, AC-4, TrueHD and MAT as separate declared formats; reject malformed codec identifiers and avoid false positives.
2. **Decode feasibility:** determine which paths are natively available on supported Apple devices and which require a properly licensed decoder. No unsupported WASM port is assumed.
3. **JOC/Atmos path:** only implement after the input bitstream can be obtained and decoded legally and technically in the browser/native host.
4. **Rendering/output:** integrate only a verified Dolby-compatible renderer or platform output path. Generic HRTF virtualization must not be relabeled as Atmos.
5. **Device acceptance:** test named iPad/iPhone models, OS versions, Safari versions, headphones, HDMI and AVR/Soundbar chains as applicable.
6. **Diagnostics:** expose independent detected/decoded/rendered/output-verified states, defaulting to unknown or not-established.

## Acceptance gates

- TypeScript, lint, unit tests and production build pass on the exact branch head.
- Existing HLS, native Safari, MP4/WebM, audio-track selection and recovery regression tests pass.
- No references remain to the retired spatial-session modules or deleted smoke scripts.
- Diagnostics never claim Atmos from JOC metadata alone.
- Physical Dolby output acceptance remains pending until recorded on named hardware.

## Scope protection

This cleanup changes only the product branch. Do not modify `main`, merge PR #99, or deploy production.
