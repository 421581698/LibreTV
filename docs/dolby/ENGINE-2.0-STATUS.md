# LibreTV Immersive Audio Engine 2.0 — implementation status

Updated: 2026-11-24  
Branch: `feature/libretv-ipad-edition-product` (PR #99, Draft)

## Landed foundations

- Read-only format detection for AC-3, E-AC-3, TrueHD, DTS, AAC and other existing codecs.
- Dolby AC-4 FourCC detection in HLS `CODECS` metadata, including the four-part codec string:
  `ac-4.<bitstream_version>.<presentation_version>.<mdcompat>`.
- AC-4 `mdcompat` is retained as bounded numeric source metadata and shown as a declared compatibility tier. It is **not** a browser/device decode result and must not enable an Atmos badge.
- HLS audio rendition inspection recognizes `ac-4` alongside the existing codecs.
- Read-only diagnostics continue to report native Dolby decode and bitstream passthrough as unknown, and Atmos object decode as not-established.
- A CORS-guarded Web Audio spatial presentation module is now present. It supports opt-in stereo headphone virtualization and a gated 5.1-to-binaural route only when an explicit 5.1 speaker layout is supplied. Its off/bypass mode is unprocessed Web Audio passthrough, not restoration of the browser-native media path.

## Deliberately not implemented yet

- No Dolby AC-4, E-AC-3 JOC, TrueHD or MAT decoder is included.
- No Dolby Atmos object renderer is integrated into the playback pipeline.
- The spatial-audio module is a standalone foundation; it is **not attached to PlayerShell or exposed as a user control**. This is intentional until a separate media-element lifecycle can guarantee safe native fallback.
- No bitstream passthrough path is implemented or verified.
- Native Safari/iOS/iPadOS decode and output capabilities remain unknown until verified on real devices and a named output chain.
- No AC-4 profile or JOC metadata may be presented as proof of decoded Atmos output.

## Integration safety gates

1. Keep browser-native playback as the default route.
2. Never attach Web Audio to a cross-origin media element unless its CORS mode and response are known safe. A failed CORS check must leave native playback untouched.
3. Respect the MediaElementAudioSourceNode one-element lifecycle: once attached, every future source assigned to that element must remain CORS-safe. PlayerShell creates ArtPlayer once and reuses `art.video` across episodes and providers; direct MP4/WebM and Safari native-HLS paths can remove `crossorigin`. Disconnecting the Web Audio graph does not restore native playback on the captured element. Therefore do not attach the engine to the existing reusable element. A future spatial session must own a distinct media element/player instance and return to a separate native element on fallback.
4. Do not infer a 5.1 speaker order from `CHANNELS=6` or `6/JOC`. Unknown layouts bypass spatial routing.
5. AudioContext activation must happen in an explicit user gesture.
6. Keep codec support hints, actual decode, object rendering, output routing and physical-device acceptance as separate states.

## Verified software gates and remaining acceptance

- Chromium HLS playback and standalone Web Audio graph smoke passed on commit `aeb2c7b9a54900698dd5cfb2ebb4e044927f0fa0` (run `45364845662`), with autoplay restrictions enabled. The graph smoke uses a same-origin generated PCM fixture; it is not a multichannel or Atmos decode test.
- iPad CSS structure audit, TypeScript, ESLint, unit tests and production build passed on commit `aeb2c7b9` (Verify run `45364845773`).
- The current follow-up commit `5f4a01d4505a2d47ddf06027abcee545e1260ad9` updates the acceptance ledger and lifecycle decision; its own CI and isolated iPad preview are still required before its status can be accepted.
- P1: validate metadata against licensed/controlled real elementary-stream samples and matching HLS manifests; parser fixtures alone are insufficient.
- P2: add real multichannel CORS-safe HLS/MSE, Safari AudioContext, suspend/resume and failure-recovery evidence. No Atmos object renderer or codec decoder is implemented.
- P3: keep PlayerShell integration disabled until a separate media-element/player session and native fallback are implemented and tested across hls.js MSE, direct MP4/WebM, Safari native HLS, track/source changes, pause/resume and teardown.
- P4: physical iPhone/iPad, AirPods/Bluetooth, USB-C, HDMI and named AVR/soundbar tests are required. These cannot be inferred from CI.
- P5: validate the read-only diagnostics on those physical output chains; report unsupported platform fields as unknown/null.
- P6: pass the exact-commit CI, isolated Preview visual audit, and real Safari/iOS regression matrix. The simulated Chromium viewport audit is not real iPad acceptance.

## AC-4 metadata reference

Dolby's HLS codec-signalling documentation defines the four-part AC-4 codec string and explains the `mdcompat` values. These values describe the compatibility level declared by the bitstream; they do not prove that a particular browser or device can decode it:

- https://ott.dolby.com/OnDelKits/AC-4_Online_Delivery_Kit_1.6/Documentation/Dolby_AC4_spec/help_files/topics/c_codec_indication.html
- https://professionalsupport.dolby.com/s/article/Dolby-Audio-and-Dolby-Atmos-in-web-apps?language=en_US
