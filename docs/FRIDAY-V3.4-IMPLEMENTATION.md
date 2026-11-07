# Friday V3.4 — Integrated Delivery

## Version decision

The release path is **V3.2 → V3.4 → V3.5 → V3.6 …**. V3.3 is skipped completely and is not a development or release target.

V3.4 is one integrated upgrade containing all nine workstreams. It preserves the existing gold holographic orb and its current wake/listen/think/respond interaction path.

## Nine workstreams

| # | Priority | Workstream | Existing baseline and V3.4 delivery |
|---|---|---|---|
| 1 | P0 | Holographic orb interaction | Preserve `FridayOrb`, `friday-orb-core.js`, and `FridayHero`; keep state-driven IDLE/LISTENING/THINKING/SPEAKING presentation, reduced-motion and device-aware rendering. Existing coverage: `fridayOrbCore.test.ts`, `sigilPerformance.test.ts`, homepage regression tests. |
| 2 | P0 | Voice lifecycle | Preserve the single `useFridayVoiceController` owner for ASR/TTS/VAD; retain secure-context and browser capability checks, recognizer retirement, bounded no-speech retry, late-event guards, unmount cleanup, and user-gesture microphone start. Existing coverage: `useFridayVoiceController.test.ts`, `browserAsr.test.ts`, `browserVadCapture.test.ts`, `voiceActivityInterrupt.test.ts`. |
| 3 | P0 | Natural voice conversation | Keep text and recognized speech on the same chat send path; retain TTS cancellation, acoustic interruption, response de-duplication, and voice resume coordination. Existing coverage: `browserTts.test.ts`, `useFridayResponseController.test.ts`, and voice lifecycle tests. |
| 4 | P1 | Intelligent movie search | Continue using real enabled LibreTV sources through `/api/chat` → `search_movie`; workflow reuses the exact returned search candidates and must not fabricate titles or resources. Existing coverage: `movie-workflow.test.ts`, adapter and movie-agent tests. |
| 5 | P1 | Player control | Add the `control_player` tool and a typed browser command adapter for play/pause/toggle, bounded seek, volume, mute, and fullscreen. The tool is exposed only when a real VOD PlayerShell reports itself active. Commands are validated again in the browser before reaching ArtPlayer. |
| 6 | P1 | Source-quality inspection | Preserve the real `/api/quality` HLS/segment probe, per-source probe duration, cache metadata, transient failure handling, and evidence-based resolution review. Never present advertised quality as measured resolution or probe duration as pure source RTT. |
| 7 | P2 | Homepage integration | Preserve the single homepage orb entry, HomeIntentCanvas/FridayHero, native search path, exact-title recommendation resolution, existing detail modal bridge, and player route boundaries. Existing coverage: `homepage-playback-regression.test.ts`. |
| 8 | P2 | Conversation and task continuity | Persist the last 30 text-only user/assistant messages per assistant profile in browser-local storage for up to 30 days. Exclude tool results, movie data payloads, and non-text content; cap each text part at 2,000 characters. Existing Dexie task event history remains separate and does not auto-replay interrupted side effects. |
| 9 | P2 | Security and performance | Preserve request-size limits, schema validation, API guard, tool allowlist, abort handling, task replay safeguards, orb frame/DPR budgets, and CI coverage. Extend Friday workflow path filters to include integrated Friday, homepage, player, and API surfaces. |

## Player-control contract

- Commands are an explicit allowlist; unknown actions and non-finite numeric parameters are rejected.
- Relative seek is bounded to one hour per command; absolute seek accepts a valid movie timeline position up to 24 hours and is clamped to the loaded media duration.
- Volume is clamped to `[0, 1]`.
- Commands require an active VOD PlayerShell; live-player behavior is not changed.
- The playback page exposes the same holographic orb as a compact toolbar entry and mounts Friday without its global floating FAB, so the assistant can control the current player without covering player controls.
- Server tool success means the command was dispatched to the active page, not proof that playback state changed. Friday must not claim that a media operation succeeded solely from dispatch acceptance.

## Conversation-history contract

- Browser-local only; no server-side transcript or cross-device sync.
- Per-assistant key, versioned payload, 30-day expiration.
- Maximum 30 messages, 2,000 characters per text part, 128 KiB stored payload.
- Only user/assistant text parts are restored; tool calls, data parts, and movie result payloads are excluded.
- Storage denial, corruption, quota errors, and private-browsing restrictions must not break the in-memory chat session.

## CI acceptance

This delivery is accepted when the PR head has both required GitHub Actions workflows green:

1. `prelaunch-checks`: dependency install, TypeScript, ESLint, unit tests, production build.
2. `friday-2.2-verify`: same verification suite, with path filters expanded to the complete Friday V3.4 integration surface.

CI-green is the user's stated acceptance criterion. No preview or production deployment is part of this work. Do not claim physical iPhone Safari or browser playback validation unless it was actually performed.

## Integration branch and PR

- Branch: `feature/friday-v3.4-complete-upgrade`
- PR: [#39](https://github.com/421581698/LibreTV/pull/39)
- Base: `main`
