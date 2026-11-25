# OpenJOC / HRTF Feasibility — Atmos Render Path (Research Only)

> Scope: PR #99 (`feature/libretv-ipad-edition-product`), Draft only.
> **Status: RESEARCH / ISOLATED VALIDATION. No Atmos renderer is enabled in LibreTV playback.**
> This document exists to keep the "Atmos is done" claim honest and to record a
> concrete decision path. It does **not** authorize shipping an Atmos renderer.

---

## 1. Bottom line

There is no implemented Dolby Atmos object-audio render path in LibreTV today.
The read-only diagnostics landed in P0/P1 only **detect and report signals**
(JOC marker, Dolby metadata family) — they do **not** decode or render Atmos.
A UI badge or a `hasJocMarker: true` value is **not** proof of Atmos playback.

An open-source research path (OpenJOC) exists and is technically interesting,
but it is **carrier-local reconstruction**, not recovery of the original authored
Atmos master, and its upstream now includes a browser-facing WASM bridge. Shipping it into LibreTV
would be a research experiment, not an "Atmos support" feature.

---

## 2. What the diagnostic layer may and may not say

| Signal | Meaning | Allowed claim |
|---|---|---|
| `format.dolbyFamily = dolby-atmos-metadata` | A metadata marker was observed in the carrier | "检测到 Atmos 元数据标记" |
| `format.hasJocMarker = true` | A JOC marker exists in metadata | "检测到 JOC 线索（仅为提示）" |
| `capability.nativeDolbyDecode` | Browser/OS native Dolby decode | always `unknown` (not probed) |
| `capability.bitstreamPassthrough` | Bitstream passthrough to an external decoder | always `unknown` (not verified) |
| `capability.atmosObjectDecode` | Atmos object decode | always `not-established` |

These values are frozen by `sanitizePlaybackDiagnostics()` and by the P0
read-only policy. Do not relax them to assert Atmos without a verified path.

---

## 3. OpenJOC (chyinan/OpenJOC) — findings

Source: https://github.com/chyinan/OpenJOC/ (README reviewed 2026-11-24).
License: core **Apache-2.0**; integration bundles may include components under
additional terms (`THIRD_PARTY_NOTICES.md`).

### 3.1 What it does

- Independent, clean-room **E-AC-3 JOC decoder and spatial renderer in Rust**.
- Extracts in-band EMDF, decodes OAMD object metadata and JOC reconstruction
  data, reconstructs **carrier-local object signals**.
- Speaker presets 2.0 → 22.2, custom geometry up to 64 output channels.
- Two-channel virtual-speaker **binaural rendering** with SADIE II D1/KU100
  (default) and D2/KEMAR profiles, or a local SOFA HRIR file.
- Experimental, opt-in 3DoF head-tracking interface via Rust/C APIs.
- Rust API and versioned C ABI; integrations for FFmpeg, GStreamer, mpv,
  Windows DirectShow/LAV.

### 3.2 Boundaries that disqualify an "Atmos is done" claim

Verbatim from the project README:

- > "Decoded JOC Objects are carrier-local reconstruction outputs, **not recovery
    of the original authored Atmos objects or source stems**."
- > "The JOC speaker/binaural bridge remains **experimental and profile-bounded**;
    its codec-domain operator `T(t)` is unresolved."
- > "Reconstructed ADM ... is **not recovery of the original authored Atmos master**.
    OpenJOC does not recover original authoring identity, source-stem PCM,
    unquantized automation, Dolby authoring provenance, or a lossless
    JOC-to-ADM round trip."
- > "OpenJOC is **not affiliated with, endorsed by, or sponsored by Dolby Laboratories**."
- The decoded-vs-authored objects page keeps `SemanticBindingState = Unresolved`.
- The renderer-equivalence note states a generic ADM renderer is **not guaranteed
  to localize exactly like native JOC playback**.
- **Update (2026-11-25):** Upstream now includes `crates/openjoc-wasm` and `.github/workflows/wasm.yml`. The `wasm32-unknown-unknown` bridge exposes decoding and PCM rendering APIs. This is not proof of LibreTV or iPad Safari integration.

### 3.3 Implication for LibreTV

The existing upstream WASM bridge removes the need to invent a new C-to-WASM compilation route. It accepts bounded raw E-AC-3 elementary bytes and CMAF audio samples with PTS. LibreTV still needs a pinned validated binary, correct HLS/TS or CMAF demuxing and timestamps, playback clock integration, worker/output isolation, licensing review and physical iPad Safari validation. A successful upstream smoke is not certified Atmos output.

---

## 4. Other referenced projects (scoping notes)

- **OpenJOC browser bridge**: the authoritative upstream package is now `crates/openjoc-wasm` in `chyinan/OpenJOC`. Its existence and upstream tests do not establish that LibreTV has shipped or verified browser playback.
- **KSPlayer** (iOS/macOS, Swift): a native player built on Apple/FFmpeg
  decoders. Relevant only as a *native* reference for how a platform player
  handles E-AC-3; it does not provide a web Atmos path and does not change the
  browser capability claims above.
- **JustOneCacophony**: included in the research scope from the original brief;
  no verified Atmos-renderer capability was established in this pass. Do not
  cite it as evidence of Atmos support.

---

## 5. Dolby trademark / licensing boundary

- The names "Dolby", "Dolby Atmos", "SADIE", and related marks belong to their
  owners. A product UI must not present a "Dolby Atmos" badge or logo based on
  diagnostics alone.
- OpenJOC core is Apache-2.0 but explicitly **not** Dolby-endorsed; integration
  bundles may carry additional terms. Any redistribution must keep the notices.
- Native Atmos rendering on Apple platforms is governed by Apple/Dolby
  licensing and is outside this repository's control. A web app cannot assert
  it from `canPlayType()` hints.
- Until legal review and a verified output path exist, the safe UI wording is
  "检测到相关元数据标记" — never "支持杜比全景声".

---

## 6. Decision path (for the owner, not auto-executed)

| Option | Effort | Atmos truthfulness | Recommendation |
|---|---|---|---|
| A. Keep read-only diagnostics + HUD | Low | Honest (no Atmos claim) | **Ship this** (done in current PR) |
| B. Native path research on Apple platforms | High | Could be real, but license-gated | Feasibility only; needs real device + legal review |
| C. OpenJOC → WASM experimental renderer | Very high | Carrier-local reconstruction only | Research spike only; do not label "Atmos support" |
| D. UI Atmos badge from JOC marker | Trivial | **False** | **Reject** — this is the exact bug we are avoiding |

The owner has now authorized an isolated option-C investigation on PR #99. A raw EC-3 frame candidate scanner and pinned-upstream WASM CI workflow have been added. Browser player integration, genuine output verification and licensing approval remain outstanding. Option D stays rejected.

---

## 7. What would change the `not-established` value

Only all of the following together:
1. A verified native bitstream/object decode path on a named device+OS.
2. Device acceptance passing on that path (out-of-band content, real output).
3. Legal sign-off on any marks/licenses used in the UI.
4. A telemetry field that is set from that verified path — not from a metadata
   marker or a `canPlayType()` hint.

Until then: `nativeDolbyDecode = unknown`, `bitstreamPassthrough = unknown`,
`atmosObjectDecode = not-established`. No exceptions.
