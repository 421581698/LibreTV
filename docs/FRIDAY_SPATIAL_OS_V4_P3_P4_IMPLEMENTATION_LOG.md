# FRIDAY SPATIAL OS V4 — P3/P4 Implementation Log

Date: 2026-11-08
Branch: `feature/friday-spatial-os-v4`

## Scope

This batch implements the P3 Friday six-state presentation bridge and P4 responsive playback workspace. It does not merge to `main`, deploy production, replace the existing voice controller, or rewrite the playback engine.

## P3 — Friday six-state presentation bridge

- Added `getFridaySpatialVisualState` in `src/lib/friday/state.ts`, mapping existing `FridayState.voice` and `FridayState.agent` reducer values to `IDLE`, `LISTENING`, `THINKING`, `EXECUTING`, `SPEAKING`, and `ERROR`.
- Preserved voice priority for active listening/speaking and exposed Agent execution separately from thinking/rendering.
- `AIFloatingBall` publishes reducer voice/agent values through `friday-home-runtime-state`; it remains the owner of the existing voice runtime. V4 does not create a second ASR/TTS/VAD lifecycle.
- `SpatialFridayEntry` subscribes to the runtime bridge, voice-error and audio-level events, maps them to the six visual states, and removes listeners on unmount.
- Movie workflow and explicit retry/recovery paths publish executing, rendering, completed, and error phases. Cancellation clears the presentation phase to idle.
- The visual entry styles distinguish executing and error states.

## P3 — Regression coverage

- Added unit coverage for all six visual states, including listening/recognizing, thinking/rendering, executing, speaking, voice error, Agent error, and priority behavior.
- Existing voice-controller tests cover recognition errors, intentional abort, stop/unmount cleanup, TTS interruption, and a subsequent recognition turn.
- Existing Task Runtime tests cover interrupted-task restoration, explicit replay of read-only tasks, and preventing automatic replay of side-effect tasks.
- Extended the homepage/playback regression contract to check the reducer-backed bridge and Agent lifecycle events (executing, rendering, completion/failure, cancellation, and recovery).
- Automated repository tests do not substitute for a physical iPhone Safari session.

## P4 — Responsive playback workspace

- Added V4 layout classes to the existing `/watch` page main region, player/details grid, and player frame.
- Added responsive styles for desktop two-column layout, mobile single-column layout, full-width mobile playback frame, safe-area bottom padding, and short landscape viewport sizing.
- Existing ArtPlayer/hls.js implementation, source selection, decoded `videoHeight` quality evidence, playback history/progress, and playback recovery logic remain unchanged.

## CI evidence

- Commit `6676af105abebbf8db2b29fc1fb35760899c89cc` passed dependency installation, TypeScript, ESLint, unit tests, and Production Build.
- Run: https://github.com/421581698/LibreTV/actions/runs/42497348172
- A subsequent test-only extension and this log are being committed after that run. Their new head SHA must receive its own CI run before the final code batch is considered fully re-verified.

## Not yet accepted

- Preview deployment and browser verification have not been performed in this batch.
- iPhone Safari physical-device acceptance has not been performed.
- No PR merge, `main` update, or production deployment has been performed.
