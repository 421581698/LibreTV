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
- Extension metadata levels with actual exported frame records (L1-L6, L8-L11).
- SHA-256 of the source input and parsed RPU bytes.
- Track/frame-limit scope, so partial analysis is not mistaken for whole-file coverage.

The JSON uses the `DolbyVisionRpuEvidence` core fields expected by `metadata-inspector.ts`, with additional provenance fields. It is local diagnostic evidence, not a playback capability claim.

## Important boundaries

- `dovi_tool` upstream currently documents HEVC RPU extraction support for Profiles 4, 5, 7 and 8. Matroska input is supported by its extractor. This adapter does not claim arbitrary MP4/HLS/AV1 extraction support.
- AV1 RPU parsing exists in the upstream `dolby_vision` crate APIs and tests, but the CLI extraction command used here is HEVC-oriented. AV1 requires a separately implemented OBU/container adapter and is not silently routed through HEVC extraction.
- A valid RPU is evidence of encoded metadata, not proof of device decoding, HDMI output mode, panel capability, or actual Dolby Vision presentation.
- A failed parser invocation is an error/unknown result, never evidence that RPU is absent.
- The web app does not bundle a native executable. Do not call this script from an Edge/Cloudflare route or browser code.

## Validation

Run unit tests with `npm test`. For an actual-stream acceptance record, retain the source hash, RPU hash, exact parser version, selected track/frame scope, Profile(s), frame count and metadata-level frame counts. Use media that the tester is authorized to analyze; do not commit copyrighted media samples to the repository.
