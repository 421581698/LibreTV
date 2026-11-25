# iPadOS native Dolby Vision acceptance

Status: **not executed — physical iPad hardware and a known-good licensed test asset are required.**

Desktop Chromium/WebKit automation, codec strings, parser output, and screenshots of a browser page cannot prove native iPadOS Dolby Vision decode or display output. Do not mark this gate complete without device evidence.

## Required test setup

- A physical iPad model whose display and iPadOS release support the Dolby Vision profile under test.
- Exact iPadOS version/build, Safari version, device model, and display configuration recorded.
- A controlled, licensed Dolby Vision HEVC sample with known profile, RPU presence, full-file SHA-256, and a matching manifest/container.
- The same asset verified on a known-good reference playback path.
- Stable network and no transcoding or server-side remuxing between source and device.

## Test matrix

| Path | Test | Required evidence |
|---|---|---|
| Safari native HLS | Open the master playlist and play the Dolby Vision variant | Selected variant, playback stability, iPadOS version |
| Safari direct file | Open the same immutable media object where supported | MIME/container and actual playback result |
| Variant fallback | Offer a non-Dolby HDR/SDR fallback | Confirm the selected rendition is not mislabeled as Dolby Vision |
| Seek / resume | Seek across multiple RPU frame ranges and resume | No stale variant or stale evidence shown |
| External display | Repeat with a supported external display if in scope | Display path and system-reported HDR/Dolby Vision state |
| Negative control | Play an SDR/ordinary HEVC sample with a misleading manifest declaration | UI must not claim RPU or Dolby Vision output |

## Pass criteria

1. The selected media object matches the tested asset's immutable ID and SHA-256.
2. The parser report is signed by the controlled parser service and verified by the backend.
3. Native playback behavior is observed on the physical iPad; no desktop simulator substitutes for this.
4. Any platform-reported Dolby Vision output state is captured from a trustworthy OS/device surface. If iPadOS exposes no reliable output signal to the web app, the app must continue to show **output unknown**.
5. The negative control never receives a positive RPU or output claim.
6. The test report records device model, iPadOS build, browser, asset hash, parser envelope key ID, playback path, selected HLS variant, and any limitations.

## Current release rule

Until these conditions are met, the LibreTV diagnostics panel must continue to label RPU, browser decode, and display output as unverified. This is an external hardware acceptance gate and cannot be completed by repository CI alone.
