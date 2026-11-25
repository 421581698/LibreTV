# Full Dolby Vision implementation contract

- Date: 2026-11-25
- Repository: LibreTV
- Target branch: `feature/libretv-ipad-edition-product`
- PR: #99 (keep Draft and unmerged)

## Product definition

“Full Dolby Vision” is an end-to-end chain, not a codec badge:

1. Source and container inspection.
2. Bitstream validation and Dolby Vision RPU / metadata extraction.
3. A real Dolby Vision-capable decoder.
4. RPU-aware Dolby Vision processing / display mapping.
5. A supported platform display path.
6. Device-and-output acceptance evidence.

The application must report each stage independently. A successful earlier stage must never imply a later stage succeeded.

## Current implementation status

| Layer | Current state | Evidence / limitation |
|---|---|---|
| Codec declaration | Implemented | RFC 6381 and HLS declaration inspection; declarations are hints only |
| HEVC RPU analysis | Implemented for the registered MP4 path | Private parser service, dovi_tool 2.3.x, source SHA-256 binding, signed evidence |
| HEVC / Matroska fixture validation | Implemented in CI | Pinned upstream 259-frame fixture; not a feature-length customer asset |
| HLS RPU analysis | Not implemented | Playlist declarations do not contain enough information to prove full-stream RPU |
| AV1 Dolby Vision RPU extraction | Not integrated | Requires a separate AV1 OBU/container adapter and fixtures |
| Dolby Vision decoding | Not integrated by LibreTV | Requires a supported native platform decoder or properly licensed decoder component |
| RPU-aware rendering / display mapping | Not integrated | No renderer is allowed to be represented as Dolby Vision processing without evidence |
| Physical Dolby Vision output verification | Pending | Requires named device, OS, content, and output-chain acceptance |

## Implementation sequence

### A. Complete media inspection

- Keep codec declaration parsing separate from elementary-stream inspection.
- Extend container adapters independently: MP4/HEVC first, then AV1/OBU and additional containers only with real fixtures.
- Bind every report to the immutable source asset ID and SHA-256.
- Preserve full-scan scope, parser identity/version, frame count, RPU digest, Profile and per-level frame coverage.
- Treat unsupported, malformed, truncated, or unavailable data as unknown/error, never as “no RPU”.

### B. Decoder integration gate

- Do not implement a pretend decoder or infer decoding from `canPlayType()`, MediaCapabilities, codec strings, or successful HTML video playback.
- Browser playback may use an OS-provided decoder internally, but the web application cannot assume that it is a Dolby Vision decoder or prove the selected output mode.
- A verifiable product decoder requires a supported platform API / native host and the relevant Dolby-authorized SDK or decoder rights.
- Record the exact decoder identity, version, supported Profiles, input format, and actual decode result.

### C. RPU-aware rendering gate

- Integrate only a Dolby-authorized or otherwise legitimately licensed rendering path that consumes the decoded video and required dynamic metadata.
- Preserve the original metadata and frame/timestamp alignment.
- Do not substitute generic HDR tone mapping, Web Audio, CSS filters, WebGL effects, or HRTF processing and call it Dolby Vision.
- If a licensed renderer is unavailable, retain native platform playback and report rendering as not integrated.

### D. Platform and output verification

- Keep web capability, native decoder capability, and physical display output as separate fields.
- Acceptance records must identify device model, OS version, player/runtime version, media asset hash, Profile, output route, and observed output mode.
- Safari/browser automation is regression evidence, not proof of physical Dolby Vision output.
- HDMI/AVR/display chains require separate acceptance; browser JavaScript cannot reliably inspect every downstream display mode.

## Product behavior until the gates pass

- Continue ordinary supported playback without claiming Dolby Vision enhancement.
- Show detected declaration, verified RPU evidence, decoder state, renderer state, and output state separately.
- Label unintegrated decoder/rendering stages as “未接入”; label unavailable physical evidence as “未验证”.
- Never show a global “Dolby Vision 已完成” success state while any required stage is unintegrated or unverified.

## Required external inputs

The following cannot be fabricated by repository code:

- Dolby-authorized SDK / decoder access and applicable licensing.
- A native host or platform API that exposes the required decode/render path.
- Authorized representative media for each Profile/container path.
- Physical acceptance on named iPhone/iPad models and output routes.

## Release acceptance

A full Dolby Vision release requires all implementation gates above, passing automated regression tests, and recorded physical-device output evidence. Until then, LibreTV may describe its verified media-inspection and RPU-analysis capabilities, but must not claim end-to-end Dolby Vision decoding or presentation.
