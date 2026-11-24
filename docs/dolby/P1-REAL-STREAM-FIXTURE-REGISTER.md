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
| IAMF | AOMedia `iamf-tools` test vectors | Independent IAMF probe/decode comparisons | Repository declares BSD 3-Clause Clear License. Verify the exact testdata path, notices and attribution before copying any individual file. | License review per file |
| AC-3 / E-AC-3 / E-AC-3 JOC | ICL Forge published conformance-vector release | Independent implementation comparison for its documented AC-3/E-AC-3 coverage | ICL Forge source is GPL-3.0-or-later. Its published vector bundle is produced by that project and carries its project license. Do not copy/vendor into this repository without a separate compatibility decision. The page describes 60 vectors, including unsigned Atmos/JOC vectors; signed Atmos-vector generation requires a signing key not shipped by the project. | External reference only |
| AAC / PCM | Chromium AAC and WAV fixtures | AAC/container metadata and PCM baseline tests | Per-file source attribution and asset license still need checking before vendoring. Synthetic PCM generated locally is suitable for routing tests, not codec-family validation. | Candidate only |
| TrueHD / MAT | No cleared fixture identified | TrueHD bitstream and MAT transport verification | No suitable, license-cleared candidate established in this review. MAT transport-marker inspection must not be confused with TrueHD decoding. | Unresolved |

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
- ICL Forge conformance vectors: https://iainchesworthlabs.github.io/iclforge/conformance-vectors/
- ICL Forge repository and GPL-3.0-or-later license: https://github.com/iainchesworthlabs/iclforge
