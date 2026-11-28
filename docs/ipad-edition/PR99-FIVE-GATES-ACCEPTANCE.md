# PR #99 — five workstreams, one acceptance batch (2026-11-28)

**Branch only**: `feature/libretv-ipad-edition-product`. PR #99 remains Draft.
No main, production, or Friday liquid-glass engine/UI changes authorized.

| Gate | Automated evidence | Still required for final acceptance |
| --- | --- | --- |
| DNS rebinding | Real Node HTTP dispatcher loopback refusal; separate public DNS preflight then private connect-time lookup; strict-public Cloudflare Wrangler flags | Hostile external DNS controlled flip including redirects/retries/IPv6; verified Cloudflare Preview requests; audit all other direct egress |
| Cross-instance cancellation | Active Friday AI SDK /api/chat now sends unique request ID, registers abort/stream cleanup and calls /api/chat/cancel; same protocol executed in **two separate Node OS processes** with one shared mock Redis REST server | Provision shared Redis **in a non-production test environment**, use actual HTTPS Upstash endpoints, route authenticated requests to two deployed instances, verify latency/error handling and ownership; currently no backend secrets configured |
| Player Shell ownership | Command arbitration and late-event tests; native play, pause, seek and simulated source switch tested as one controller; browser HLS smoke verifies two real external sources with Chromium | Real PlayerShell end-to-end with play/pause, seek, source switch, fullscreen, subtitles and native iPad Safari |
| HDR continuous frames | 180 ordered 30 fps timestamped P010 samples through color/renderer mock, bounded pending frame and burst fallback tests | Continuous HDR **physical GPU** frame time, memory, energy/thermal, dropped frames on compatible hardware and real source; avoid claiming mock throughput is GPU FPS |
| Dolby Vision / HDR output | RPU parsing/PTS CI and decoded-P010 / extended GPU submission unit tests; original Safari native HDR path preserved | Physical HDR/Dolby display evidence on HDR-capable iPad using authorized verified sources. Need measured display behavior, metadata integrity, color gamut, rotation, fullscreen, subtitles, long playback |

## Evidence collection protocol for compatible real iPad

Record exact iPad model, iPadOS/Safari build, display and external-display hardware, brightness/True Tone settings, source asset hash, Dolby/HDR codec and RPU/HLG/PQ evidence, timestamp, orientation and fullscreen mode. Measure frame cadence and thermal behavior over a sustained playback period, plus seek/source switch/subtitle/rotation recovery. Save device screenshots/recordings and hardware color/brightness measurements where feasible; a screenshot alone cannot establish physical HDR luminance. Report any unsupported format as unsupported, not PASS.

## Release / infrastructure blockers

- Hosted Redis and two deployed instances do not exist in this branch's CI; a shared mock is valuable integration evidence **but not a Redis deployment acceptance**.
- Browser automation or a successful WebGPU `rgba16float` GPU queue submission cannot independently certify Dolby Vision or HDR physical display output.
- Cloudflare Workers Builds remains a separate gate; a previous account read indicated build-minute quota exhaustion. Refresh and verify rather than guessing that current code caused failure.
- An overall five-gate PASS requires all external and real-device evidence. Until then keep PR Draft and do not merge or deploy production.
