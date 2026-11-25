# LibreTV Dolby-only audio engine — current status

Updated: 2026-11-25  
Branch: `feature/libretv-ipad-edition-product`  
PR: #99 (Draft; keep open and unmerged)

## Authoritative architecture

[Dolby-only architecture reset](./DOLBY-ONLY-ARCHITECTURE-RESET.md) is the current product-scope authority. The earlier generic HRTF/spatial-session implementation was retired. Historical P1–P6, P3 lifecycle, and device-matrix documents are retained as historical research/specification and must not be read as evidence that the retired renderer remains in the player.

The product must report four independent states:

1. **Detected** — source-declared Dolby codec/JOC metadata was recognized.
2. **Decoded** — a supported Dolby decoder actually decoded the selected stream.
3. **Rendered** — a verified Dolby Atmos/object-rendering path processed the decoded content.
4. **Output verified** — a named physical device and output chain passed acceptance.

Metadata, codec strings, channel counts, browser capability hints, and Web Audio availability cannot promote one state into another.

## Current implementation boundary

- Read-only format and HLS audio metadata inspection exists for supported Dolby-family declarations.
- Codec identifiers are validated conservatively; malformed prefixes and ambiguous group-level declarations must not be treated as proof of a specific track's decoded format.
- JOC is metadata only. It does not prove Atmos object decoding or rendering.
- Playback diagnostics distinguish browser capability hints from actual decode/output evidence.
- Native ArtPlayer/HTMLMediaElement playback, hls.js/MSE, Safari native HLS, direct MP4/WebM, audio-track selection, and playback recovery remain the playback infrastructure.
- Playback auto-recovery policy remains read-only by default; diagnostics do not silently switch sources or downgrade quality.
- Dolby Vision RPU analysis is a separate video-evidence path and does not establish Dolby audio decoding or Atmos output.

## Capability status

| Capability | Current status | What is still required |
|---|---|---|
| Dolby format/metadata detection | Implemented as read-only software inspection | Controlled licensed bitstreams and matching manifests for broader real-stream validation |
| Native Dolby decoding | Not established | A supported platform decoder and verifiable decode evidence |
| E-AC-3 JOC / Atmos object decoding | Not implemented / not established | A technically and legally supported decoder path |
| Atmos object rendering | Not implemented / not established | Verified Dolby-compatible object renderer and known object-based test content |
| Dolby bitstream passthrough | Not implemented / not verified | Platform integration and receiver-side input-status evidence |
| Physical iPhone/iPad output | Not tested | Named device, OS/browser, source fixture and output-chain records |
| Diagnostics truthfulness | Software foundations implemented | Continue regression checks to prevent metadata being promoted to decode/render/output claims |

## Acceptance gates

- Exact-head CI must pass for the current PR branch SHA.
- Existing native playback, HLS, MP4/WebM, audio-track selection and recovery regression tests must pass.
- No references may remain to retired spatial-session modules or deleted generic spatial smoke scripts in active player code.
- JOC or a channel count must never be presented as proof of Atmos decoding/rendering.
- Physical Dolby output remains unaccepted until evidence is recorded for named hardware and a known test source.

## Release boundary

PR #99 remains Draft and unmerged. Work stays on `feature/libretv-ipad-edition-product`. Do not modify `main`, merge the PR, or deploy production as part of this work.
