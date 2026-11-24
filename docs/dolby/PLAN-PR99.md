# LibreTV Cinema Engine — Dolby Audio P0 + Playback Stability P0

## Scope

This change adds a conservative, testable foundation for media-format identification, browser audio capability reporting, and playback-health diagnostics. It does not claim to decode Dolby Atmos, TrueHD, DTS:X, or any other bitstream in JavaScript.

## Modules

- \`src/lib/format-detector.ts\`: identify container/codec hints from MIME types, file extensions, codec strings, and HLS audio metadata. A JOC marker is reported as metadata only.
- \`src/lib/audio-inspector.ts\`: normalize HLS \`EXT-X-MEDIA:TYPE=AUDIO\` declarations and hls.js audio-track metadata. Six channels alone do not establish a 5.1 speaker order.
- \`src/lib/capability-manager.ts\`: report browser/device capabilities and distinguish known facts from capabilities that cannot be reliably queried by web APIs.
- \`src/lib/playback-stability.ts\`: classify buffer starvation, stalls, dropped-frame degradation, offline state, and recovery retry timing.

## Safety and truthfulness

1. Original media playback remains the fallback. Diagnostics must not interrupt playback.
2. Browser APIs do not expose a universal, reliable "Dolby Atmos decoded" flag. This implementation never infers Atmos decoding from a codec string, \`6/JOC\`, channel count, or AudioContext support.
3. Bitstream passthrough and hardware decode are reported as unknown unless independently verified by a platform-specific integration.
4. HLS \`CHANNELS\` is treated as declared metadata. A channel count is not a speaker-layout guarantee.
5. Stability classification is observational. It does not silently switch sources, lower quality, or restart playback; a player integration must explicitly consume its recommendations.

## Integration plan

- First consume the stability snapshot in PlayerShell as telemetry only.
- Add explicit, user-controlled recovery actions after real device testing.
- Keep spatial audio routing isolated behind its existing opt-in controls; never attach Web Audio to a non-CORS source.
- Record real-device Safari results separately from CI.

## Acceptance

- Vitest: unit tests for format classification, capability truthfulness, HLS metadata and stability thresholds.
- TypeScript strict check, ESLint and production build must run on the PR head.
- TestSprite / Playwright should cover state transitions and playback regressions.
- Physical iPhone/iPad Safari validation remains a separate required gate.

## Explicit non-goals

- No Atmos object decoder, Dolby license integration, TrueHD decoder, DTS:X decoder, or HDMI/AVR bitstream passthrough.
- No automatic source switching or quality reduction.
- No production deployment or merge.
