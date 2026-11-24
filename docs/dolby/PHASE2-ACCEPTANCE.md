# Phase 2 Acceptance — Read-Only Playback Diagnostics

> Scope: PR #99 (`feature/libretv-ipad-edition-product`), Draft only.
> This document separates **what has been verified** from **what still requires real-device testing**.
> Do not read a passing automated check as a passing device acceptance.

---

## 1. Status at a glance

| Environment | Status | Evidence |
|---|---|---|
| Chromium (sandbox, headless Chrome 144, real HLS playback) | ✅ **Verified** | Real `hls.js` playback of a locally served HLS fixture; telemetry read back from `localStorage` (see §2) |
| Unit / type / lint / build | ✅ Verified | `vitest`, `tsc --noEmit`, `eslint src`, `next build` — see PR #99 P1 comment |
| Chromium (interactive desktop) | ⏳ **Pending** | §3.1 |
| Mac Safari | ⏳ Pending | §3.2 |
| iPhone Safari (iOS) | ⏳ Pending | §3.3 |
| iPad Safari (iPadOS) | ⏳ Pending | §3.4 |
| Real Dolby / Atmos content | ⏳ Pending | §4 |

**Phase 1 rule (unchanged):** the player is strictly **read-only**. It detects and reports, but never auto-switches source, never auto-downgrades quality, and never auto-restarts the player. Manual source switching by the user remains enabled.

---

## 2. What was verified in the sandbox (Chromium)

Method: production build served locally (`AUTH_DISABLED=true`, `next start`), a 20-second HLS fixture (H.264 + AAC stereo) generated with ffmpeg and served from the app's own `public/`, played through the **real** `/watch` page with `?url=` + `?source=` + `?sourceUrl=` injection. After natural end-of-playback, the persisted `libretv-settings` store was read back.

Real playback state observed during the run:

```json
{ "readyState": 4, "currentTime": 11.9, "duration": 20, "paused": false,
  "videoWidth": 640, "videoHeight": 360, "buffered": 20 }
```

The exact telemetry sample written by the real playback chain (`playbackHealth.e2e.samples[0].diagnostics`):

```json
{
  "format": {
    "container": "hls",
    "audioCodec": "unknown",
    "dolbyFamily": "unknown",
    "confidence": "unknown",
    "hasJocMarker": false
  },
  "audio": null,
  "capability": {
    "browserFamily": "chromium",
    "nativeDolbyDecode": "unknown",
    "bitstreamPassthrough": "unknown",
    "browserDecode": "not-probed",
    "atmosObjectDecode": "not-established",
    "safeDefault": "native-media-playback"
  },
  "stability": {
    "health": "healthy",
    "peakStallMs": 180,
    "peakDroppedFrameRatio": 0
  }
}
```

Read-only markers on the same sample:

```json
{ "autoRecoveryMode": "read-only", "suppressedRecoveries": 0 }
```

What this proves:

- All four diagnostic modules were driven by **real** events (`format` from the media URL, `capability` from the real `navigator`/`canPlayType`, `stability` from real `readyState`/buffered/stall timing). This is not a mocked unit test.
- Atmos is **not** claimed: `dolbyFamily: unknown`, `nativeDolbyDecode: unknown`, `atmosObjectDecode: not-established`.
- No automatic recovery was executed: `autoRecoveryMode: read-only`, no source-switch dialog opened, no player reconstruction.
- `audio: null` is expected here — the fixture has a single muxed track (no separate HLS audio rendition). A multi-rendition stream is exercised in §4.

Note: `recoveries: 1` / `stalls: 1` in the sample are **statistics** of a brief startup buffer-and-resume (`video:waiting` → `video:playing`), not automatic recovery actions. Only suppressed/executed recovery actions are gated by the read-only policy.

---

## 2.5 On-screen diagnostics HUD (no DevTools required)

A read-only diagnostics HUD is now part of the player, so the same telemetry can be inspected **on a real device without opening DevTools** and copied back to the developer.

- **Where**: on the watch page, a small `音频诊断` badge sits under the quality control at the top-right of the player. If a JOC / Atmos-metadata signal is detected the badge turns amber and reads `音频诊断 · JOC 线索` — this is a *signal* indicator, **not** an Atmos "working" claim.
- **How to use**: tap the badge to expand the panel. It groups the same快照 as the telemetry: 媒体格式 / 音轨 / 能力探测 / 播放稳定性.
- **Copy for verification**: tap `复制诊断报告（发给开发者）`. The clipboard text contains only enums, booleans and bounded numbers — no media URL, token, rendition name or free-form note.
- **Fixed disclaimer** shown verbatim at the top of the panel:
  > 杜比全景声（Atmos）对象解码 / 原生 Dolby 解码 / 位流直通均未验证。JOC 或 Dolby 元数据仅代表音轨中检测到相关标记，不等于设备已还原 Atmos 声场。

The HUD is strictly display-only. Opening it or copying the report never switches source, never changes quality and never restarts playback. The P0 read-only policy (`PHASE1_AUTO_RECOVERY_POLICY`) is unchanged.

Sandbox verification of the HUD (Chromium, production build):

| Check | Result |
|---|---|
| Badge renders on real `/watch` page | ✅ |
| Panel expands with format/capability groups | ✅ |
| Atmos rows show 未验证 / 未确立 (no false claim) | ✅ |
| Copy button writes a URL/token-free plain-text report to clipboard | ✅ |
| No source-switch dialog on open/copy | ✅ |

---

## 3. Real-device acceptance matrix

For each environment, use a real stream you control. Two fixtures are recommended:

- **F1 — plain HLS**: H.264 + AAC stereo, single rendition. Expected: `format.container = hls`, `capability.browserFamily` matches the browser, `audio = null` (no separate rendition), `stability.health` ∈ {`healthy`,`degraded`}.
- **F2 — multi-audio HLS**: an HLS stream with multiple audio renditions (e.g. one labeled with `channels="6/JOC"` / codec `ec-3`, one AAC stereo). Expected: `audio.renditionCount ≥ 2`, and any JOC marker is reported **only** as a hint (`hasJocMarker: true`), never as confirmed Atmos.

### Common steps (all environments)

1. Open the watch page with a direct HLS URL:
   ```
   /watch?url=<HLS_URL>&source=e2e&id=<unique-id>&title=<title>&sourceUrl=<any-http-url>
   ```
   (`sourceUrl` only needs to be a syntactically valid http(s) URL to satisfy source resolution; a real detail API is not required for direct-URL playback.)
2. Let playback run to natural end (or navigate away) so `flushPlaybackMetrics()` writes telemetry.
3. Open DevTools console and read the persisted store:
   ```js
   const s = JSON.parse(localStorage.getItem('libretv-settings'));
   const st = s.state || s;
   console.log(st.playbackHealth?.e2e?.samples?.slice(-1)[0]);
   console.log(st.playbackResourceHealth);
   ```

### 3.1 Chromium — interactive desktop

| # | Check | Pass condition |
|---|---|---|
| C1 | Video plays end-to-end | `currentTime` advances; `ended === true`; no error overlay |
| C2 | Diagnostics present | `diagnostics` object exists on the flushed sample; `capability.browserFamily = chromium` |
| C3 | F2 audio renditions | With F2, `audio.renditionCount ≥ 2`; `audio.maxChannels`/`hasJocMarker` match the manifest |
| C4 | No auto switch | No source-switch dialog opens during a ≥12s stall; `autoRecoveryMode = read-only` |
| C5 | No auto quality change | Selected rendition index does not change without user action |
| C6 | No auto restart | Media element is not recreated (element identity stable) after a recoverable stall |

### 3.2 Mac Safari

| # | Check | Pass condition |
|---|---|---|
| M1 | Native playback works | Video plays; no error overlay |
| M2 | Capability reported | `capability.browserFamily = safari` |
| M3 | No false Atmos claim | `nativeDolbyDecode = unknown`, `atmosObjectDecode = not-established` even if the stream carries JOC hints |
| M4 | `browserDecode` hint only | With F2, `browserDecode ∈ {not-probed, can-play-hint, cannot-play-hint}` — a hint, never a decoded-Atmos claim |
| M5 | Read-only behaviour | Same as C4–C6 |

### 3.3 iPhone Safari (iOS, real device)

| # | Check | Pass condition |
|---|---|---|
| I1 | Native playback works | Video plays in Safari (not just in an added-to-home-screen PWA) |
| I2 | Capability reported | `capability.browserFamily = safari`; `safeDefault = native-media-playback` |
| I3 | Telemetry flushed | Sample appears in `playbackHealth` after end/navigate (note: iOS may throttle `localStorage` writes — read after the page is foregrounded) |
| I4 | No false Atmos claim | Same as M3 |
| I5 | Read-only behaviour | No automatic source switch / quality change / restart |
| I6 | HUD panel | `音频诊断` badge visible; panel shows 未验证 / 未确立; copied report has no URL/token |

### 3.4 iPad Safari (iPadOS, real device)

| # | Check | Pass condition |
|---|---|---|
| P1 | Native playback works | Video plays in Safari |
| P2 | Capability reported | `capability.browserFamily = safari` |
| P3 | Multi-audio renditions | With F2, `audio.renditionCount` reflects the manifest; JOC is a hint only |
| P4 | No false Atmos claim | Same as M3 |
| P5 | Read-only behaviour | No automatic source switch / quality change / restart |
| P6 | HUD panel | Same as I6; verify the amber `JOC 线索` badge (if shown) reads as a hint, not an Atmos claim |

**Note on iPhone/iPad:** WebKit is the only browser engine allowed on iOS/iPadOS; Chrome/Firefox there are WebKit wrappers. A "Chromium passed" result does **not** substitute for these rows.

---

## 4. Real Dolby / Atmos content (separate track)

This is a distinct workstream from the read-only diagnostics landing. Even with real JOC content:

- `hasJocMarker: true` means **"a JOC marker was observed in metadata"** — it is **not** proof of native Atmos object decoding.
- `atmosObjectDecode` must remain `not-established` until a verified native bitstream path exists and passes device acceptance.
- `bitstreamPassthrough` must remain `unknown`/`not-established` until verified against a real Dolby output device.
- Do not surface a "Dolby Atmos" badge in the UI based solely on these diagnostics.

---

## 5. Telemetry field reference (for verifying samples)

`diagnostics` fields and legal values:

| Field | Type / values | Meaning |
|---|---|---|
| `format.container` | `hls`/`mp4`/`mkv`/`webm`/`mpeg-ts`/`unknown` | Container detected from the media URL |
| `format.audioCodec` | `eac3`/`ac3`/`truehd`/`dts-hd`/`dts`/`aac`/`opus`/`flac`/`alac`/`unknown` | Audio codec hint; not a decode guarantee |
| `format.dolbyFamily` | `dolby-digital`/`dolby-digital-plus`/`dolby-truehd`/`dolby-atmos-metadata`/`none`/`unknown` | Dolby family hint; `unknown` unless evidenced |
| `format.confidence` | `declared`/`inferred`/`unknown` | How the format was determined |
| `format.hasJocMarker` | boolean | JOC marker hint only |
| `audio.renditionCount` | number | Count of separate HLS audio renditions |
| `audio.maxChannels` | number / `null` | Max channel count across renditions (`null` when unavailable) |
| `audio.hasJocMarker` | boolean | JOC hint from audio renditions |
| `capability.browserFamily` | `safari`/`chromium`/`firefox`/`other`/`unknown` | Detected engine family |
| `capability.nativeDolbyDecode` | always `unknown` | Native Dolby decode is not asserted |
| `capability.bitstreamPassthrough` | always `unknown` | Bitstream passthrough is not asserted |
| `capability.browserDecode` | `not-probed`/`can-play-hint`/`cannot-play-hint` | `canPlayType` hint only |
| `capability.atmosObjectDecode` | always `not-established` | Atmos object decoding is not asserted |
| `capability.safeDefault` | always `native-media-playback` | Safe fallback |
| `stability.health` | `healthy`/`low-buffer`/`buffering`/`stalled`/`offline`/`degraded`/`unknown` | Health state from real timing signals |
| `stability.peakStallMs` | number | Longest observed stall (bounded) |
| `stability.peakDroppedFrameRatio` | number 0–1 | Peak dropped-frame ratio (bounded) |

Read-only markers: `autoRecoveryMode = 'read-only'`, `suppressedRecoveries` = count of automatic recoveries blocked by the policy.

---

## 6. Sign-off

- [ ] Sandbox Chromium (§2) — done
- [ ] Interactive Chromium (§3.1)
- [ ] Mac Safari (§3.2)
- [ ] iPhone Safari (§3.3)
- [ ] iPad Safari (§3.4)
- [ ] Real Dolby content (§4)

Until every applicable row is signed off on real hardware, Phase 2 device acceptance is **not complete**. Keep PR #99 in Draft; do not merge or deploy based on automated checks alone.
