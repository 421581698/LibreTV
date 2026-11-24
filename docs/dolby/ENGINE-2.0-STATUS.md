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
- The spatial-audio module is a standalone foundation; it is **not yet attached to PlayerShell or exposed as a user control**.
- No bitstream passthrough path is implemented or verified.
- Native Safari/iOS/iPadOS decode and output capabilities remain unknown until verified on real devices and a named output chain.
- No AC-4 profile or JOC metadata may be presented as proof of decoded Atmos output.

## Integration safety gates

1. Keep browser-native playback as the default route.
2. Never attach Web Audio to a cross-origin media element unless its CORS mode and response are known safe. A failed CORS check must leave native playback untouched.
3. Respect the MediaElementAudioSourceNode one-element lifecycle: once attached, every future source assigned to that element must remain CORS-safe. PlayerShell currently reuses its video element across episodes and sources, so a UI integration must solve this lifecycle before enabling the engine there.
4. Do not infer a 5.1 speaker order from `CHANNELS=6` or `6/JOC`. Unknown layouts bypass spatial routing.
5. AudioContext activation must happen in an explicit user gesture.
6. Keep codec support hints, actual decode, object rendering, output routing and physical-device acceptance as separate states.

## Next implementation gates

- P2a: test the spatial engine against a browser AudioContext test harness and CORS-safe HLS/MSE media.
- P2b: design a player lifecycle that can safely opt into Web Audio without breaking source switching, native HLS or Safari playback.
- P2c: add a user-controlled spatial presentation setting only after P2b passes; default remains off.
- P3: evaluate real decoder paths separately for AC-4, E-AC-3 JOC and TrueHD. OpenJOC is a research-only Rust project, not a drop-in browser/WASM decoder.
- P4: verify each named browser, OS, output device and content fixture on physical hardware. Keep Atmos object decode and passthrough unverified until the corresponding path is demonstrated end-to-end.

## AC-4 metadata reference

Dolby's HLS codec-signalling documentation defines the four-part AC-4 codec string and explains the `mdcompat` values. These values describe the compatibility level declared by the bitstream; they do not prove that a particular browser or device can decode it:

- https://ott.dolby.com/OnDelKits/AC-4_Online_Delivery_Kit_1.6/Documentation/Dolby_AC4_spec/help_files/topics/c_codec_indication.html
- https://professionalsupport.dolby.com/s/article/Dolby-Audio-and-Dolby-Atmos-in-web-apps?language=en_US
