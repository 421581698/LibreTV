# P1 Real-Stream Fixture Register

Updated: 2026-11-24  
Repository: `421581698/LibreTV`  
Branch: `feature/libretv-ipad-edition-product`  
PR: #99 (Draft)

## Purpose and acceptance boundary

This register separates four different kinds of evidence:

1. **Declaration evidence** — a playlist, container header, or track metadata says a codec is present.
2. **Elementary-stream evidence** — bytes are parsed and independently identified as the expected codec/bitstream.
3. **Decode evidence** — a decoder successfully decodes the payload and the result is checked against an independent reference or known output.
4. **Device/output evidence** — a real browser/device/output chain demonstrates what was actually decoded and delivered.

Passing a parser unit test or reading a `CODECS` string is not elementary-stream validation. Successful decoding is not proof of Atmos object rendering or HDMI bitstream passthrough.

## Candidate fixture register

| Family | Public candidate | Useful scope | Provenance / licensing disposition | Current acceptance |
|---|---|---|---|---|
| AC-3 | Chromium `bear.ac3` | Elementary-stream framing/parser smoke | Chromium README says converted from `bear.ogv`; the README description alone does not establish a redistribution grant for the source media or each derived asset. Reference only; do not vendor pending per-file license review. | Candidate only |
| E-AC-3 | Chromium `bear.eac3` | E-AC-3 framing/parser smoke | Same provenance and per-file licensing caveat as `bear.ac3`. | Candidate only |
| AC-3 / E-AC-3 in MP4 | Chromium fragmented MP4 samples | Container sample-entry and payload-path tests | README describes them as remuxes of the Chromium AC-3/E-AC-3 samples. Container presence is not a separate license grant. | Candidate only |
| AC-4 | Chromium `ac4-ajoc.ac4`, `ac4-channel-based-coding.ac4`, `ac4-ims.ac4` | AC-4 metadata/container inspection; A-JOC marker handling | Chromium README attributes these as Dolby-encoded. No per-file redistribution permission was established. Do not vendor or redistribute pending rights review. | Candidate only; no decode claim |
| DTS / DTS:X | Chromium `dts.bin`, `dtsx.bin` | Single-frame identification and narrow parser tests | README describes one frame each. A single frame cannot validate full programme playback. The DTS MP4 examples are moov-only with no media payload and are not bitstream tests. | Candidate only |
| IAMF | Chromium `iamf_alternating_sine_waves_714.mp4` | IAMF-in-MP4 descriptor/layout parsing and synthetic channel routing | README describes generated alternating 440 Hz sine/silence content. Useful for container and synthetic decode-path tests; not authored Atmos content and not Dolby decoding. | Candidate only |
| IAMF | AOMedia `iamf-tools` small standalone samples at pinned tree `7a52020dec74976394a730455a473e2933350b4d`: `noise_1024samp_5p1_opus.iamf` (2,240 B; blob `bf38be00a9a89267fa976a31c02fa227200d74c8`), `noise_1024samp_stereo_flac.iamf` (4,293 B; blob `bb4f3589da46e81cc8a32887b0b8e38eb9136ca4`), `noise_3s_stereo_opus.iamf` (2,321 B; blob `db7f22bd951727bbc1d26a5ad7c85a94a96cea17`), `tones_100ms_1OA_stereo_opus.iamf` (4,730 B; blob `7e2909224088438bc41e380c21116eb3d6597cc4`), `tones_256samp_5p1_pcm.iamf` (3,188 B; blob `895577f15633e216d3fc6bfa264a73a714c2f4c1`) | Candidate standalone IAMF parser/probe tests for Opus, FLAC, PCM, stereo, 5.1 and 1OA. AOMedia's probe inspects descriptor OBUs and optional temporal units **without decoding**; decode comparison requires the separate `libiamf` reference decoder. The larger `test_*.iamf` / MP4 suite is generated from checked-in `.textproto` metadata and WAV inputs, not prebuilt as a complete suite in this tree. | Repository README says BSD 3-Clause Clear License; LICENSE also includes AOM Patent License 1.0 and states that patent rights are not received from suppliers. The testdata README describes these five small files as synthetic noise/tone samples. Exact binary Git blob IDs and byte sizes are pinned above; these are Git object IDs, **not SHA-256 digests**. No separate per-file audio asset license/attribution statement was found in the inspected testdata docs, so do not assume the software license settles all media rights. Keep external-only pending asset-scope confirmation. | Candidate only; no redistribution approval and no decoder result recorded |
| AC-3 / E-AC-3 / E-AC-3 JOC | ICL Forge published conformance-vector release | Independent implementation comparison for its documented AC-3/E-AC-3 coverage | ICL Forge source is GPL-3.0-or-later. Its published vector bundle is produced by that project and carries its project license. Do not copy/vendor into this repository without a separate compatibility decision. The page describes 60 vectors, including unsigned Atmos/JOC vectors; signed Atmos-vector generation requires a signing key not shipped by the project. | External reference only |
| AAC / PCM | Chromium AAC and WAV fixtures | AAC/container metadata and PCM baseline tests | Per-file source attribution and asset license still need checking before vendoring. Synthetic PCM generated locally is suitable for routing tests, not codec-family validation. | Candidate only |
| TrueHD / MAT | No cleared fixture identified | TrueHD bitstream and MAT transport verification | No suitable, license-cleared candidate established in this review. MAT transport-marker inspection must not be confused with TrueHD decoding. | Unresolved |


### Pinned IAMF source review

- Upstream repository: https://github.com/AOMediaCodec/iamf-tools
- Reviewed immutable tree: `7a52020dec74976394a730455a473e2933350b4d`
- Small-vector inventory: https://github.com/AOMediaCodec/iamf-tools/blob/7a52020dec74976394a730455a473e2933350b4d/iamf/cli/testdata/iamf/README.md
- Test-data generation and vector semantics: https://github.com/AOMediaCodec/iamf-tools/blob/7a52020dec74976394a730455a473e2933350b4d/iamf/cli/testdata/README.md
- Probe semantics: https://github.com/AOMediaCodec/iamf-tools/blob/7a52020dec74976394a730455a473e2933350b4d/docs/iamf_probe_main.md
- Independent decode reference: https://github.com/AOMediaCodec/libiamf
- SHA-256 values have **not** been recorded; Git blob IDs above pin the upstream objects but are not SHA-256. Do not put them in a SHA-256 field or imply a file hash verification has occurred.

### IAMF decoder and licensing audit (2026-11-24)

The pinned `iamf-tools` revision exposes two distinct command-line paths:

- `probe_main` parses descriptor OBUs and can optionally scan temporal units; it does **not** decode audio.
- `decoder_main` is a separate example decoder that accepts a standalone `.iamf` input and writes a multichannel WAV. Its documented invocation is:
  `bazel-bin/iamf/cli/decoder_main --input_filename=<sample.iamf> --output_filename=<output.wav>`.
  This is useful as an implementation cross-check, but it is not the AOM normative reference decoder.

The normative reference decoder is maintained separately in `AOMediaCodec/libiamf`. Its current release reviewed for this register is `v2.0.1`, pinned to commit `63cafdd9b2d7bdba08cfeec2f008718198d7362e`. The upstream README identifies this repository as the decoder-only reference implementation for IAMF v2.0.0. Use this pinned version as the reference side of a future decode comparison; do not silently substitute a moving `main` branch.

**License finding:** the pinned `iamf-tools` root LICENSE grants BSD-3-Clause software rights and includes the AOM Patent License 1.0 text. However, the small-vector inventory and testdata README describe the five files as synthetic noise/tone samples but do not provide an explicit per-file asset copyright/redistribution grant. The software license therefore does not close the media-asset rights question. Keep all five binary samples external-only until the asset scope is confirmed. No sample has been copied into LibreTV.

**Execution status:** no probe or decoder binary was built or run in this review. No output WAV, PCM hash, channel-by-channel comparison, or reference-decoder result exists yet. Therefore all five samples remain candidate-only. The next controlled run must record, per exact sample, (1) probe JSON and temporal-unit scan result, (2) `iamf-tools` decoder exit status and output WAV metadata/hash, (3) `libiamf v2.0.1` decoder result and output WAV metadata/hash, and (4) a documented comparison policy. Exact PCM byte equality must not be assumed if the two implementations use different rendering or limiter paths; compare decoded substream/PCM only under a defined common mix, layout, sample rate, and tolerance.

Pinned references:
- `iamf-tools` decoder CLI: https://github.com/AOMediaCodec/iamf-tools/blob/7a52020dec74976394a730455a473e2933350b4d/docs/iamf_decoder_main.md
- `iamf-tools` probe CLI: https://github.com/AOMediaCodec/iamf-tools/blob/7a52020dec74976394a730455a473e2933350b4d/docs/iamf_probe_main.md
- Exact pinned software license: https://github.com/AOMediaCodec/iamf-tools/blob/7a52020dec74976394a730455a473e2933350b4d/LICENSE
- IAMF v2.0.1 reference decoder: https://github.com/AOMediaCodec/libiamf/tree/63cafdd9b2d7bdba08cfeec2f008718198d7362e

## Rules before a fixture can be used

- Record the exact upstream URL, immutable revision/release, filename, SHA-256, upstream license, source-media attribution, and any additional terms.
- A repository-wide license does not automatically settle the rights in third-party media assets stored in that repository.
- Do not commit a binary fixture until its exact-file redistribution status and required notices are reviewed.
- If a fixture is only externally referenced, tests must fetch it only through an explicitly controlled, reproducible process; do not make CI depend on an unstable third-party URL.
- Preserve a clean distinction between synthetic vectors, real programme content, container-only samples, and single-frame parser samples.
- For each sample, record the parser result, an independent probe result, decoder result (if applicable), and expected output/hash. A successful probe is not a successful decode.
- For Atmos/JOC, record whether object metadata is present in the elementary stream and whether the decoder actually renders it. A marker or metadata field alone is not object rendering.
- Never describe browser support, native Dolby decode, HDMI passthrough, or Atmos output based solely on a fixture's codec label.

## Next executable P1 work

1. Identify a small set of exact-file candidates whose license and provenance can be cleared for use, starting with AOMedia IAMF vectors and any Chromium fixtures with explicit asset-level notices.
2. For candidates that cannot be redistributed, decide whether a pinned, opt-in external test is acceptable; otherwise leave them as manual references.
3. Add an offline fixture manifest with hashes and expected probe fields only after the candidate files are approved.
4. Keep TrueHD/MAT unresolved until a legitimate sample and independent reference are available.

## References

- Chromium media test-data README: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/test/data/README.md
- AOMedia IAMF tools: https://github.com/AOMediaCodec/iamf-tools
- AOMedia IAMF testdata README (sample descriptions and generated-suite workflow): https://github.com/AOMediaCodec/iamf-tools/blob/main/iamf/cli/testdata/README.md
- AOMedia IAMF small standalone sample inventory: https://github.com/AOMediaCodec/iamf-tools/blob/main/iamf/cli/testdata/iamf/README.md
- ICL Forge conformance vectors: https://iainchesworthlabs.github.io/iclforge/conformance-vectors/
- ICL Forge repository and GPL-3.0-or-later license: https://github.com/iainchesworthlabs/iclforge
