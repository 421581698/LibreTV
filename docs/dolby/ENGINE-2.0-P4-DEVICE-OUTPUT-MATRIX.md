> **SUPERSEDED for current product architecture (2026-11-24):** This document records the earlier generic spatial-audio / multi-format implementation plan and must be treated as historical evidence only. The generic HRTF and independent spatial-session path has been retired. Current product scope and acceptance rules are defined in [DOLBY-ONLY-ARCHITECTURE-RESET.md](./DOLBY-ONLY-ARCHITECTURE-RESET.md). Do not use this document to claim that the retired spatial renderer remains implemented or that Dolby Atmos decoding/rendering is complete.

# P4 — Physical device and output-chain acceptance matrix

- Status: Not run — physical hardware evidence is required.
- Scope: LibreTV Dolby Immersive Audio Engine 2.0, PR #99 (Draft).
- Rule: Browser capability flags, manifest metadata, generated PCM, and Chromium automation are not physical-output evidence.

## Evidence vocabulary

Record each layer independently. Use only: `Not started`, `In progress`, `Pass`, `Fail`, `Blocked`, `Not applicable`.

1. **Source evidence** — fixture identity, license/permission, container, declared codec, measured elementary-stream format, channel count and verified speaker layout.
2. **Browser evidence** — device model, OS version, browser/version, playback path (Safari native HLS, hls.js/MSE, or direct media), and browser-reported capabilities.
3. **PCM evidence** — whether decoded PCM reaches the selected output. Record the measurement method; do not infer it from a codec label.
4. **Bitstream evidence** — whether a Dolby bitstream is actually passed through to the receiver. Require receiver/AVR input-status evidence; a browser setting or UI label is insufficient.
5. **Atmos object evidence** — whether the receiver reports an Atmos input and whether the tested source is a known Atmos object-based fixture. A generic Dolby badge or multichannel PCM is insufficient.

## Device/output matrix

| ID | Source device | Output route | Required evidence | Status |
|---|---|---|---|---|
| P4-01 | iPhone | Built-in speakers | iPhone model, iOS, Safari version, source fixture, PCM/output observation | Not started |
| P4-02 | iPad | Built-in speakers | iPad model, iPadOS, Safari version, source fixture, PCM/output observation | Not started |
| P4-03 | iPhone | AirPods / Bluetooth | AirPods model, iOS, connection type, source fixture, actual output observation | Not started |
| P4-04 | iPad | AirPods / Bluetooth | AirPods model, iPadOS, connection type, source fixture, actual output observation | Not started |
| P4-05 | iPhone/iPad | USB-C audio interface / DAC | Device and adapter/DAC model, OS, output format/rate if exposed, measured PCM | Not started |
| P4-06 | iPhone/iPad | USB-C to HDMI → AVR/soundbar | Adapter, HDMI chain, display/receiver model, receiver input-status evidence | Not started |
| P4-07 | iPhone/iPad | HDMI → Atmos-capable AVR/soundbar | Known licensed Atmos fixture, receiver model/firmware, receiver-reported Atmos input and output mode | Not started |

## Per-run record

Copy this block for every tested device/output combination:

- Run ID and date/time:
- Source fixture and permission/license:
- Source container / declared codec:
- Elementary-stream verification:
- Device model:
- OS version:
- Browser and version:
- Playback path:
- Output route and adapter:
- Receiver / soundbar model and firmware (if applicable):
- Browser capability report:
- PCM output evidence and measurement method:
- Dolby bitstream passthrough evidence:
- Atmos object evidence:
- Expected vs observed result:
- Result: Not started / In progress / Pass / Fail / Blocked / Not applicable
- Evidence artifact or photo/log reference (remove personal identifiers):
- Notes / reproduction steps:

## Acceptance rules

- Built-in speakers and Bluetooth output can validate audible PCM playback, not HDMI bitstream passthrough.
- USB-C DAC output can validate PCM only when the output format is independently measured or reliably reported.
- HDMI receiver status must identify the actual incoming signal. The receiver's general Atmos capability does not prove Atmos was delivered.
- An Atmos result requires both a known object-based source and receiver-side evidence. Multichannel PCM alone does not prove Atmos object metadata survived.
- A failure or unavailable platform signal must be recorded as such; never fill gaps with inferred codec names, output-device names, channel maps, or decoder identity.
- P4 remains open until each supported device/output combination has its own evidence record. A single successful combination does not generalize to all iPhone/iPad models or accessories.
