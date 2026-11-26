# LibreTV Cinema Engine V5.1 Pro — acceptance evidence and iPad Safari gate

**Branch:** `feature/libretv-ipad-edition-product` (existing Draft PR #99). Do not merge, modify `main`, change production, or redesign any existing Cinema control cards.

## Source-to-screen evidence chain

`authorized, DRM-free compressed sample → checked stream identity/hash → WebCodecs VideoDecoder → actual P010 10-bit VideoFrame planes → source-bound exact PTS → independently verified HDR10+ T.35 sample → float / 10-bit HDR color transform → strict P010 VideoFrame → extended rgba16float WebGPU presenter → actual native device display measurement`

Code paths:
- `src/lib/cinema-v51-live-decoder.ts`: actual compressed packet to WebCodecs decode; requires an authorized demuxer to provide immutable source binding, genuine codec description, keyframes and real frame timestamps
- `src/lib/cinema-v51-decoder-adapter.ts`: P010 4:2:0 limited-range extraction from true decoded VideoFrame, honoring Y / UV plane offsets and strides
- `src/lib/cinema-v51-hdr10plus.ts`, `src/lib/cinema-v51-runtime.ts`: bounded T.35 ST 2094-40 parsing, metadata digest, frame identity and PTS checks
- `src/lib/cinema-v51-p010.ts` and `src/lib/cinema-v51-color.ts`: Rec.709/BT.2020 and PQ/HLG/SDR 10-bit pixel transform
- `src/lib/cinema-v51-clock.ts` and `src/lib/cinema-v51-frame-bridge.ts`: exact PTS scheduling, cancel on seek/episode change or output refusal
- `src/lib/cinema-v51-frame-renderer.ts` and `src/lib/cinema-v51-webgpu-presenter.ts`: genuine P010 VideoFrame and extended rgba16float display-p3 WebGPU path with fail-closed unsupported-device fallback
- `src/lib/cinema-v51-playback-mount.ts`, `src/components/player-shell.tsx`: optional authorized source only, never indiscriminately replace native Safari HLS playback
- `src/lib/cinema-v51-sound.ts`: independent, opt-in PCM EQ/compression and HRTF path; restores native audio on capture failure, seek, source switching or AudioContext interruption

## What automated tests can establish

- Unit and integration: P010 sample packing, HDR10+ payload bounds and true frame binding, source mismatch / stale PTS rejection, color vectors, audio route no-double-output and context/capture/seek fallback.
- CI Chromium smoke: playback, synthetic real PCM capture and Web Audio DSP/HRTF processing, native fallback. This is not an external amplifier, physical speaker or iPad result.
- CI WebKit smoke: supported browser playback and native-audio fallback, **not a physical iPad**.
- Preview visual audit: unchanged control layout and geometries, not HDR panel luminance or speaker playback verification.

## Hard limits and mandatory device acceptance

1. A generic HLS URL is **not** a trusted P010 demux source. The authorized demuxer/registry is required; unsupported sources play through the existing native Safari/HLS path without a fake enhanced-HDR badge.
2. Successful GPU submission is **not** proof that the panel emitted 10-bit PQ/HLG, BT.2020 or HDR10+ dynamic output. Verify actual iPad and display behavior with source instrumentation and a reliable colorimeter / screenshot-plus-output evidence.
3. HRTF means virtualized binaural PCM from Web Audio. It does **not** decode Dolby Atmos object metadata and must never be labeled as certified Dolby Atmos.
4. The physical iPad Safari gate requires a real iPad (device model/iPadOS build recorded), real authorized SDR/HDR10/HLG/HDR10+/Dolby Vision sources, repeated portrait/landscape/rotation/multitasking tests, play/pause, seek, audio-track and source switches, network interruption, background/resume and native fallback. Record audio quality and A/V sync under headphones/speakers, memory, thermal and battery effects.
5. **No real physical iPad evidence has been supplied through this development environment. Do not mark iPad Safari device acceptance PASS until it is actually executed and attached.**

## Final approval rules

- All required CI workflows must pass for **the same current HEAD SHA**, not an older cancelled/superseded run.
- Preserve the existing three-card Cinema UI; tests must be about media processing rather than adding switches.
- Keep Draft PR #99 and production isolated until all authorized acceptance work is complete and explicitly approved.
