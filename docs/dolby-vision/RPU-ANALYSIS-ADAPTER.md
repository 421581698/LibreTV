# Dolby Vision RPU analysis adapter

## Design decision

LibreTV is deployed on both Node-capable and Cloudflare/OpenNext targets. The Dolby Vision parser is therefore an **offline/local analysis adapter**, not a browser dependency and not a Cloudflare Worker subprocess.

The adapter invokes the upstream `dovi_tool` CLI and emits a compact JSON evidence record. It does not upload media, change streams, rewrite RPU data, or alter playback.

Upstream references:

- Repository: https://github.com/quietvoid/dovi_tool
- Pinned compatibility target: `dovi_tool 2.3.4`
- License: MIT (upstream root and `dolby_vision` crate)
- The upstream project documents `extract-rpu`, `info --summary`, and JSON export of extension metadata levels.

## Usage

Install a reviewed `dovi_tool` 2.3.x binary for the local OS, then run:

```bash
# Analyze an HEVC elementary stream or supported Matroska input.
node scripts/dolby-vision/analyze-rpu.mjs --input ./sample.hevc

# Analyze an already-extracted RPU binary.
node scripts/dolby-vision/analyze-rpu.mjs --input ./RPU.bin --kind rpu

# Matroska: select a video track and optionally bound the frame range.
node scripts/dolby-vision/analyze-rpu.mjs --input ./sample.mkv --track 1 --limit 500
```

Set `DOVI_TOOL_BIN` or pass `--dovi-tool` when the executable is not on PATH.

## Evidence produced

- Parser identity and version.
- RPU presence after a successful extraction or successful parsing of a supplied RPU file.
- Parsed Profile(s); a single Profile is returned only when the inspected RPU range is uniform.
- Parsed frame count.
- Extension metadata levels with actual exported frame coverage (L1-L6, L8-L11); counts represent distinct frame indices, not raw export-record totals.
- SHA-256 of the source input and parsed RPU bytes.
- Track/frame-limit scope, so partial analysis is not mistaken for whole-file coverage.

The JSON uses the `DolbyVisionRpuEvidence` core fields expected by `metadata-inspector.ts`, with additional provenance fields. It is local diagnostic evidence, not a playback capability claim.

## Evidence contract and media binding

The browser-side contract is defined in `src/lib/dolby-vision/rpu-evidence-contract.ts` and covered by `rpu-evidence-contract.test.ts`.

- The contract accepts the adapter's strict report shape and currently pins the reviewed parser compatibility range to `dovi_tool 2.3.x`.
- SHA-256 values must be 64-character hexadecimal digests. The source digest is compared with a separately computed digest of the exact media asset before a report can be marked `matched`.
- A source hash mismatch rejects the report. Missing source hash means `detached`, not trusted for the currently playing asset.
- A report generated from a standalone `RPU.bin` is always `detached`; its hash identifies the RPU input, not the media file from which it may have originated.
- Unknown fields, inconsistent Profile/metadata-level summaries, and invalid extraction scope are rejected.

This contract is currently a validation boundary and testable integration primitive. The player does **not** load arbitrary report JSON, compute a whole-media digest, or display imported RPU evidence yet. A future transport must authenticate who produced the report and bind it to the exact selected media bytes; a self-reported `verified: true` field alone is not authentication.

## HEVC/Matroska integration fixtures

The CI also exercises the adapter against the upstream `dovi_tool 2.3.4` integration fixtures:

- `assets/hevc_tests/regular.hevc`: a complete HEVC elementary-stream test asset containing Dolby Vision RPU data.
- `assets/hevc_tests/regular.mkv`: a Matroska test asset whose HEVC video track contains the same RPU sequence.
- Both files are fetched from the pinned upstream release tag and checked against their Git blob object IDs before analysis.
- The upstream extractor test asserts that the extracted RPU matches `regular_rpu.bin` and contains 259 RPU frames. LibreTV's CI now independently requires the adapter report to contain exactly 259 frames, no selected-track restriction, no frame limit, matching input SHA-256, a non-empty RPU SHA-256, and internally consistent per-level frame counts.
- CI remuxes the pinned real HEVC fixture into an MP4 container, then exercises the actual private parser HTTP service with real `ffprobe`, FFmpeg `hevc_mp4toannexb`, and `dovi_tool 2.3.4` (not mocked subprocesses). The test verifies the complete 259-frame RPU result, original MP4 SHA-256 binding, extracted HEVC digest, and Ed25519 signature.

These are complete upstream integration-test assets, not feature-length movie samples. Passing this CI proves the HEVC elementary-stream, Matroska, and MP4 parser-service paths against the pinned real encoded fixture. It does not establish compatibility with every real-world HEVC encode, container, profile, or an entire commercial movie. A feature-length acceptance report still requires a specific authorized media asset and its immutable registry ID.

## Important boundaries

- `dovi_tool` upstream currently documents HEVC RPU extraction support for Profiles 4, 5, 7 and 8. Matroska input is supported by its extractor. This adapter does not claim arbitrary MP4/HLS/AV1 extraction support.
- AV1 RPU parsing exists in the upstream `dolby_vision` crate APIs and tests, but the CLI extraction command used here is HEVC-oriented. AV1 requires a separately implemented OBU/container adapter and is not silently routed through HEVC extraction.
- A valid RPU is evidence of encoded metadata, not proof of device decoding, HDMI output mode, panel capability, or actual Dolby Vision presentation.
- A failed parser invocation is an error/unknown result, never evidence that RPU is absent.
- The web app does not bundle a native executable. Do not call this script from an Edge/Cloudflare route or browser code.

## Validation

Run unit tests with `npm test`. For an actual-stream acceptance record, retain the source hash, RPU hash, exact parser version, selected track/frame scope, Profile(s), frame count and metadata-level frame counts. Use media that the tester is authorized to analyze; do not commit copyrighted media samples to the repository.
