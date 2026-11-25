# Dolby Vision native playback and HDR output — implementation and acceptance boundary

**PR #99** | Status: **not physically accepted** | Branch: `feature/libretv-ipad-edition-product`

This is an acceptance contract for real Dolby Vision playback, not a claim that
LibreTV has shipped a Dolby Vision decoder, a metadata compositor, or a
hardware bitstream passthrough interface. Do **not** merge browser capability
signals, signed RPU analysis, ordinary HEVC playback, and real display output
into one green status.

## Platform paths

1. **Safari / iPadOS HTMLVideoElement native HLS.** The existing player uses
   the browser-native HLS path when hls.js Media Source playback is unavailable,
   leaving variant selection and the decoder/compositor to the OS. A compatible
   codec declaration and HLS `VIDEO-RANGE` aid platform selection; they are not
   evidence that a particular device decoded or displayed Dolby Vision.
2. **Browser capability signals.** `canPlayType()` can report `probably`,
   `maybe`, or an empty response for declared codecs. The
   `(dynamic-range: high)` media query may indicate a capable display
   environment. Neither surface reports which HLS rendition was selected or
   whether Dolby Vision RPU metadata reached the output compositor.
3. **Native AVFoundation path (future iOS wrapper, if one exists).** An iOS
   native application may use `AVPlayer` and its HDR mode availability API,
   but this **cannot** be called directly from a Safari web page. A native
   capability bridge must never be presented as implemented unless there is
   actual native source code and target-device test evidence.
4. **WebAssembly / custom decoder.** A parser or RPU extractor is not a licensed
   Dolby Vision video decoder or display pipeline. Do not pretend to apply
   proprietary dynamic metadata using CSS filters or ordinary HDR tone mapping.
   Browser JS does not expose a standard API to assert hardware DV passthrough.

Official references:
- Apple HLS authoring: https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html
- Apple HLS example streams: https://developer.apple.com/streaming/examples/
- Apple AVPlayer: https://developer.apple.com/documentation/avfoundation/avplayer/
- Apple AVPlayer HDR mode: https://developer.apple.com/documentation/avfoundation/avplayer/hdrmode
- Web Media Capabilities: https://www.w3.org/TR/media-capabilities/

Current Apple HLS guidance describes different Dolby Vision HEVC and AV1
profiles; this does not imply that every Safari version, device generation, or
display supports each profile. Confirm the exact format on target hardware.

## Evidence levels (never substitute one for another)

| Level | Required evidence | Does **not** prove |
| --- | --- | --- |
| Declaration | Exact manifest/MP4 codec declaration and `VIDEO-RANGE` | Valid RPU or playback |
| Capability hint | Device/browser version and exact `canPlayType`/HDR query result | Actual decode, metadata processing, HDR output |
| Cryptographic analysis | Immutable asset hash, full RPU parsing, graph digest, verified Ed25519 report | Hardware decode or display output |
| Real playback | **Licensed unmodified full-length HEVC/AV1 source**, observed audio/video progression, selected playback path, duration/seek tests, captured device model and OS build | HDR/DV output unless independently measured |
| Real HDR / DV output | Trusted system/display pipeline report or reference measurement; file/variant/profile and output device chain recorded | Other devices or other profiles automatically working |

## Required end-to-end device procedure

- Record the source's license/usage permission, *actual* unmodified full-media
  SHA-256, codec/profile/level, duration, frame count, and independent reference
  decoder or known-good playback result. Do not use a mock or short synthetic
  fixture as a substitute for full-media acceptance.
- For HLS, record the master/variant playlists, selected output rendition from
  a trusted network/server trace or platform instrumentation, immutable init
  and media member hashes, graph SHA-256, all fragment signatures and per-sample
  timeline checks. The browser's manifest declaration alone does not establish
  which rendition it played.
- Verify the browser-native playback path and a *separate* SDR fallback on a
  real iPhone and a real iPad, each with device model, build, display and
  external display configuration. Capture play/pause, seek across fragment
  boundaries, source switch, subtitle and quality-control behavior, resume,
  portrait/landscape and fullscreen.
- Compare HEVC Dolby Vision and AV1 Dolby Vision independently. An Apple device
  may support one codec/profile but not the other. Distinguish decoder failure,
  unsupported variant, profile mismatch, and HDR/display fallback.
- Where available, collect system/display HDR mode state or instrumented video
  output evidence. If Safari does not expose trusted HDR mode information,
  record **output unknown** instead of inventing a positive result.
- For true per-frame Dolby metadata handling, obtain independently trustworthy
  evidence that the native system compositor consumed the RPU, or document this
  as an unobservable platform-controlled operation.
- For bitstream passthrough, identify an actual authorized passthrough API and
  measure the stream/output link. Retaining Dolby metadata in the source file is
  **not** proof of bitstream passthrough.

## Release gate

Do not label any of the following **PASS** using CI alone: end-to-end real
HEVC film playback, end-to-end real AV1 film playback, per-frame Dolby Vision
rendering on hardware, hardware bitstream passthrough, real HDR display output.

When hardware, licensing, instrumentation, or full-film source is missing, the
corresponding status is **BLOCKED/NOT VERIFIED**. Continue with other work on
PR #99, keep it Draft, do not merge to main, and do not deploy production.

## Instrumented Safari playback timeline (PR #99 development)

The Dolby Vision diagnostics panel now subscribes to the **same mounted**
`HTMLVideoElement` as ArtPlayer. It reports actual, locally observed
`timeupdate` progression (at least one second with non-zero video dimensions),
the observed video dimensions, and native `MediaError.code`. It discards
observations on `loadstart`, `emptied`, seeking, media-element replacement,
and native errors. An unreported or stalled media timeline remains unverified.

This is an **instrumentation capability**, not a completed Safari acceptance
test. In particular, the HTML media API reports neither verified decoded
Dolby Vision RPU nor final display HDR mode or actual hardware bitstream
passthrough. Even observed advancing video frames must not upgrade those
statuses without a physical-device reference measurement. Unit tests cover
the conservative observation state machine, not real-source acceptance.

The live test operator should capture the panel's progress and dimensions
*alongside* the asset SHA-256, verified RPU evidence and the actual device
and output-path observations. Keep full HEVC and AV1 acceptance gates
**NOT VERIFIED** until independent licensed media and Safari devices are
available.

Official Apple HLS authoring guidance (recheck per OS and codec):
- https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html
- https://developer.apple.com/av-foundation/Incorporating-HDR-video-with-Dolby-Vision-into-your-apps.pdf

Apple's HLS guidance describes explicit Dolby Vision profiles, HLS rendition
declarations and compatible HDR fallbacks. Native AVFoundation can manage
advanced Dolby Vision metadata on supported Apple devices; browser JavaScript
cannot claim to control those OS stages or observe the final HDR pixels.
