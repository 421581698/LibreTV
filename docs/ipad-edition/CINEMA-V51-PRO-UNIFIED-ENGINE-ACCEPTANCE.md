# LibreTV Cinema V5.1 Pro — unified audio/video implementation and acceptance

Status: **Feature branch implementation; NOT frozen; NOT production-approved.**
Scope: `feature/libretv-ipad-edition-product` / PR #99 only. The PR stays Draft.
Neither `main` nor Netlify Production may be modified or merged without separate authorization.

## Mature upstream research boundaries

- [FFmpeg](https://github.com/FFmpeg/FFmpeg): decoder/demuxer, source timestamps, DSP and channel mapping. FFmpeg has LGPL/GPL components: **no upstream FFmpeg binary/code is vendored by this batch**. Browser WASM builds require separate license and resource review.
- [hls.js](https://github.com/video-dev/hls.js): HLS segment lifecycle, alternate audio and timing. Existing dependency stays. HLS.js normally passes actual decoding to the browser and does **not** automatically expose decoded PCM.
- [mpv](https://github.com/mpv-player/mpv) and [libplacebo](https://github.com/haasn/libplacebo): scene-referred tone-curve, chroma/headroom and GPU processing principles. Native source code is not copied; the implementation consists of independent WebGPU WGSL and WebGL GLSL SDR passes.
- Browser HRTF PannerNodes are used rather than claiming a licensed Dolby Atmos object decoder or a certified SOFA HRTF set.

Review upstream license, patent obligations, maintenance, iPad Safari support and real media before importing any additional codec binaries.

## 01 — source-bound PCM contract

`src/lib/cinema-v51-pcm.ts` provides:

- A strict AAC-LC ADTS demuxer, validated packet sizes, sampling rates and channels.
- A WebCodecs AudioDecoder path from compressed AAC payloads to planar Float32 PCM.
- Immutable 64-hex source identity checks on **every packet**, bounded AudioDecoder pressure and sorted PTS in microseconds.
- An in-memory bounded PCM queue with explicit presentation clock offset, late-frame rejection and no unbounded buffering.

`src/lib/cinema-v51-hls-aac.ts` handles only verified **clear Packed AAC HLS** payloads:

- Each segment's full SHA-256 is compared with independently supplied immutable registry evidence.
- The ID3 PRIV timestamp `com.apple.streaming.transportStreamTimestamp` provides exact 90 kHz PTS. It is mapped using a separately verified origin, not the download time.
- An invalid ID3 frame, gap/reversal, mismatched digest, other codec or alternate transport fails closed.
- No network fetch, untrusted CMS URL or browser credential is introduced. MPEG-TS, fMP4, encryption/DRM, LL-HLS and arbitrary audio formats are **not** implemented by this adapter.

`src/lib/cinema-v51-pcm-playback.ts` connects a separately authorized source to Web Audio:

- A bounded PCM sample queue and video-clock scheduling gate decoded non-silent buffers before native source mute.
- AAC buffers go through real EQ/dynamics, optional virtual spatialization and limiter via Web Audio.
- Pause, seek, source change, context interruption, insufficient data, invalid PTS, failed decoding, disconnected video or rejected routing restore the original audio.
- The exact audio track and video PTS offset MUST come from a trusted server asset binding. Merely passing identical claimed hashes is **not authentication**.
- `PlayerShell` exposes an optional `cinemaV51AuthorizedAudioSource` prop; ordinary CMS/HLS requests do not populate it, so the existing safe capture/mirror path continues to be used when permitted.

### Audio acceptance not yet established

No authorized full-length clear media asset / server-signed fragment provenance source has been attached to the ordinary watch route. Therefore **do not claim independent PCM decoding works for all HLS/MP4/CMS playback**. Test on an authorized clear AAC source with real timestamps, rate changes, seeking, pauses, source switches, AirPlay, output latency, CPU and memory measurements.

## 02 — Audio Pro

`src/lib/cinema-v51-sound.ts` implements:

- Sub-bass shelf, mid-bass presence, anti-mud notch, speech and intelligibility EQ, controlled treble.
- Dynamic range compressor, limiter and a bounded adaptive loudness gain, without boosting digital silence.
- Live native audio is not muted until decoded/captured nonzero PCM is observed.
- Native original is restored after interruption or unsupported media input.

These are independently implemented PCM effects, not AC-3/E-AC-3/Dolby bitstream decoding or certified Dolby speaker output.

## 03 — Spatial Pro

- Two-channel HRTF panners for stereo and six separate virtual speakers for verified 5.1 channel order: L/R/C/LFE/SL/SR.
- Only claim six-channel routing when a capture track actually reports six channels or the authorized decoded PCM has six channels.
- No Dolby Atmos JOC object reconstruction, certified multi-speaker output, room calibration, SOFA personalization or head tracking is claimed.
- Per-device acoustic / latency listening acceptance remains mandatory.

## 04 — Vision Pro

`cinema-hdr-webgpu.ts` and `cinema-hdr-gpu.ts` now share a stronger SDR scene-dependent exposure/contrast/saturation curve plus bounded 4-neighbor local-detail sharpening and bright-edge suppression.

- WebGPU first, WebGL fallback, adaptive internal resolution when frames run slowly.
- Draw only when media frame readback is allowed; do not replace native HDR/PQ/HLG/Dolby Vision surfaces with a false 8-bit enhancement.
- Real physical HDR, Dolby Vision dynamic RPU rendering and 10-bit display output remain unverified.
- Compare side-by-side visually on a real iPad in a bright/dark SDR fixture and inspect clipping, ringing and GPU frame times.

## 05 — three distinct startup animations

`src/components/cinema-startup-overlay.tsx` provides independent 1.8s Vision / Audio / Spatial animations over the player. Pointer events pass through and reduced-motion preferences are respected.

- The self-developed effects are labeled **Cinema Vision/Audio/Spatial**, not certified Dolby technologies.
- The native Safari video-route animation is expressly labeled native path, with physical HDR output still unverified.
- Animation is driven by actual processed frame/active PCM state, not merely by clicking a button.
- Native Dolby audio output is never implied from a codec declaration alone.

## 06 — verification and freeze gates

Unit/integration test files cover ADTS headers, source checks, PCM queue backpressure, WebCodecs planar copy, verified HLS ID3 timing/hash, fail-closed behavior, live DSP state and 5.1 routing.

To freeze this release ALL of the following are required:

- [ ] TypeScript, ESLint, Vitest and Next build pass for the same HEAD.
- [ ] Full PR CI checks and Preview Playwright HLS/browser/player geometry tests pass for that HEAD.
- [ ] TestSprite actually executes with a valid project/credential; optional skipped steps do not count.
- [ ] Preview visual confirmation of 3 animations, layout preservation, player overlays and closed captions.
- [ ] Authorized real clear AAC/HLS/MP4 with verified identities exercises independent decoding, buffer pressure, seek, pause, source/rate switching and A/V PTS continuity; TS/fMP4 need explicit demux work.
- [ ] Physical iPad Safari full playback, portrait/landscape, AirPlay/headphones, spatial impression, HDR capabilities, audio delay and CPU/battery acceptance.
- [ ] No silence, double audio, audio loss, false Dolby certification, source credential leakage, protected media bypass or regression in non-iPad routes.
- [ ] Final acceptance report signed off before any freeze. **Do not merge, modify main or deploy production without explicit authorization.**

### Decision

This batch contains real implementation work, but cannot be called fully delivered or frozen without the external media/device gates above. GitHub CI success alone is not evidence of physical HDR/Dolby/Atmos performance.
