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
| CMS episode-to-asset binding | Implemented (operator-attested exact MP4 mapping) | Requires exact source key, VOD ID, episode index, provider URL SHA-256 and playback URL SHA-256; lookup is fail-closed and playback switches to the immutable registered MP4 asset. No title/ID-only inference |
| HEVC / Matroska fixture validation | Implemented in CI | Pinned upstream 259-frame fixture; not a feature-length customer asset |
| HLS declaration mapping | Implemented (declaration-only) | Safari native HLS inspection now reports per-variant codec declarations; media-segment RPU and cross-segment continuity remain unimplemented |
| HLS immutable graph inspection | Implemented (graph evidence only) | Protected collector and Next.js endpoints traverse the registered root/variant playlist graph and return content-addressed initialization/segment members; the Dolby Vision panel displays graph counts. Segment RPU extraction and continuity remain unimplemented |
| Clear fMP4 HLS assembly | Implemented (parser-input preparation only) | New collector worker verifies registered init/segment SHA-256, exact graph order, ftyp/moov + moof/mdat boxes and sequential mfhd numbers, then assembles a bounded MP4 input. RPU extraction, tfdt/sample-duration continuity and signed HLS graph evidence remain unimplemented |
| AV1 OBU structural inspection | Partial foundation | Bounded raw OBU scanner counts metadata/T.35 OBUs and rejects malformed lengths; Dolby provider identification, EMDF parsing, RPU extraction, container adapters and signed AV1 evidence remain unimplemented |
| Dolby Vision decoding | Not integrated by LibreTV | Requires a supported native platform decoder or properly licensed decoder component |
| RPU-aware rendering / display mapping | Not integrated | No renderer is allowed to be represented as Dolby Vision processing without evidence |
| Physical Dolby Vision output verification | Pending | Requires named device, OS, content, and output-chain acceptance |

## Implementation sequence

### A. Complete media inspection

- Ordinary CMS `/watch` playback must not infer a registry resource from a CMS VOD ID, title, source key, or playback URL. Complete integration requires a server-side, verified mapping from the exact CMS episode/source identity to a registered direct-media resource; absent that mapping, the UI must keep the asset unbound.
- The exact CMS binding path now has an operator-only registration endpoint and a server-authenticated lookup. Registration requires a validated PUBLIC PLAYER_CONFIRMED single MP4 resource plus its registered `video/mp4` asset. The composite key includes `source_key`, `vod_id`, `episode_index`, SHA-256 of the configured provider URL, and SHA-256 of the exact playback URL. The watch page hashes the two exact URL strings in UTF-8; when and only when all fields match, it switches playback to the immutable registry asset and supplies its asset ID to the Dolby Vision panel. Otherwise ordinary CMS playback continues unbound.

- For registered HLS resources, the protected graph endpoint returns only resource-bound immutable asset identities and ordered parent/child roles; the UI reports playlist, initialization, and media-segment counts. This is graph inspection, not bitstream/RPU analysis.
- The collector image packages the assembly module and verifies its import/CLI at build time. An authenticated `POST /v1/registry/resources/{resourceId}/hls-assembly/{variantAssetId}` endpoint streams the assembled MP4 candidate to trusted backend callers and deletes the temporary file after streaming.
- A separate collector worker can assemble one selected clear VOD fMP4 rendition from the verified graph. It rejects encryption, discontinuities, byte ranges, MPEG-TS, missing/extra members, digest mismatches and non-sequential fragment sequence numbers. It now verifies root playlist bytes and emits a deterministic graph-manifest SHA-256 covering root/variant identity plus ordered initialization and media members, their roles, hashes, lengths, and fragment sequence numbers. This digest is provenance input for a future HLS-specific signed report; it is not itself a signature or RPU evidence. Sequential `mfhd` numbering is not proof of timestamp/frame continuity; `tfdt`/sample-duration continuity remains unknown. The assembled file is only a candidate parser input and is not a signed HLS RPU report.
- Keep codec declaration parsing separate from elementary-stream inspection.
- Extend container adapters independently: MP4/HEVC first, then AV1/OBU and additional containers only with real fixtures.
- Bind every report to the immutable source asset ID and SHA-256.
- Preserve full-scan scope, parser identity/version, frame count, RPU digest, Profile and per-level frame coverage.
- Treat unsupported, malformed, truncated, or unavailable data as unknown/error, never as “no RPU”.

### A1. AV1 Dolby Vision adapter contract (Profile 10 / dav1.10)

AV1 is a separate bitstream path and must not enter the HEVC NAL parser.

- Recognize the Dolby Vision AV1 signaling profile independently (for example, `dav1.10`); signaling is only an eligibility hint.
- Parse AV1 OBU headers and payload lengths with strict bounds checks. Preserve temporal-unit and frame-unit boundaries; reject truncated, malformed, or unsupported OBU streams.
- Locate Dolby Vision metadata only in the AV1 metadata OBU carrying ITU-T T.35 metadata. Validate the Dolby-specific country/provider identifiers and the EMDF wrapper before extracting an RPU payload.
- Validate the extracted RPU using the Dolby Vision RPU parser, then bind the report to the exact source asset SHA-256, parser/library identity and version, OBU/frame/temporal-unit counts, RPU digest, Profile and metadata-level coverage.
- Do not treat arbitrary T.35 metadata, a codec string, or an OBU count as proof of Dolby Vision RPU.
- Start with raw AV1 elementary-stream fixtures. Add IVF or MP4 adapters only as separate container layers with real fixtures and timestamp/temporal-unit mapping tests.
- Keep AV1 signed evidence schema-distinct or explicitly versioned from the existing HEVC report. Never label an AV1 report as `inputKind=hevc`.
- Current `dovi_tool 2.3.4` CLI is used by the HEVC pipeline and is not, by itself, an AV1 demux/extraction command. Reuse of lower-level AV1/EMDF parsing APIs must be independently wrapped and tested; do not assume the CLI supports AV1 because the library contains AV1 helpers.

Required AV1 tests: OBU size overflow/truncation, invalid metadata type, wrong T.35 country/provider, malformed EMDF, empty/invalid RPU, multiple metadata OBUs, missing temporal delimiter, frame/temporal-unit alignment, unsupported container, and source-hash mismatch.

### A2. AV1 parser candidate review

A public MIT-licensed fork of quietvoid/dovi_tool was inspected as a research candidate (reviewed commit 024c15877d88dc662ac45e86dfba297f50256921). It contains an AV1 OBU reader, an IVF reader, Dolby T.35/EMDF recognition, and AV1 RPU fixtures. It is not adopted as a production dependency in this PR.

The inspected parser code needs hardening before reuse:

- Its general LEB128 helper does not report unterminated or overlong encodings as errors; metadata-type parsing must use a strict bounded decoder.
- The OBU reader allocates according to the declared payload length without an application-level per-OBU cap; enforce a configured maximum before allocation.
- The IVF frame-header reader treats any UnexpectedEof as clean EOF, including a partially truncated header; distinguish zero-byte EOF from partial-header truncation.
- Container parsing, OBU parsing, metadata identification, and RPU validation must remain separate stages with independent negative tests.

The fork is therefore a source of implementation ideas and fixtures only. Any reuse requires a reviewed, pinned commit, strict parser fixes, license attribution, fuzz/property tests, and CI evidence before production integration. The repository now contains a separate bounded raw-OBU structural scanner as a defensive first step; it intentionally reports RPU presence as `unknown` and is not an AV1 Dolby Vision parser or extraction implementation.

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
