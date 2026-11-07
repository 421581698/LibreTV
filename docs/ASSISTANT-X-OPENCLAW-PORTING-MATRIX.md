# Assistant-X-OpenClaw → Friday V3 Porting Matrix

## Goal

Port the useful user-facing capabilities of rubintry/assistant-x-openclaw into LibreTV Friday V3 without importing its desktop-only runtime wholesale. Friday remains a Next.js/React browser application and must preserve LibreTV playback/search behavior.

This document is the implementation and acceptance source of truth. A feature is not complete because a UI exists: it needs a working adapter, lifecycle/error handling, tests, and (where browser permissions or device behavior are involved) real-device verification.

## Runtime boundary

| Upstream capability | Friday V3 implementation | Porting decision | Acceptance evidence |
|---|---|---|---|
| Multi-assistant profiles (assistants.json) | Typed assistant profile registry, persisted active profile, per-profile prompt/voice/visual metadata | Port concept; do not expose server secrets in browser config | Profile schema tests, switching tests, prompt isolation tests |
| OpenClaw Gateway per-agent routing | Server-only Gateway adapter; map selected profile to an allow-listed Agent ID | Port with server-side credentials, strict URL policy, timeouts, cancellation and response validation | Adapter contract tests; auth/timeout/SSRF tests; live integration only with user-supplied Gateway |
| Hermes engine | Optional provider adapter behind the same server-side interface | Port only if compatible with deployment/runtime and explicitly configured | Contract parity tests; no silent fallback across engines |
| KWS wake word | Browser session wake strategy while page is active and microphone permission is granted | Adapt, not clone: no background/always-on claim; browser tabs cannot promise desktop-grade continuous local KWS | Permission-denied, tab-hidden, stop/restart and iOS Safari tests |
| Streaming/offline ASR (SenseVoice/Zipformer/Qwen3) | ASR provider interface; current browser speech recognition remains baseline; optional remote/local service adapter | Model inference is not bundled into the web app unless a compatible WASM/WebGPU/local service is provided | Partial/final transcript, duplicate event, timeout, abort and fallback tests |
| VAD and interruption | Existing VAD interruption controller and voice lifecycle | Preserve existing lifecycle; make mic ownership exclusive and teardown deterministic | Race, startup-failure, TTS interruption and unmount tests |
| TTS (Piper/VITS/MeloTTS/ZipVoice) | Existing TTS provider abstraction and Piper integration | Add providers behind the abstraction; no model binaries or credentials in client bundle | MIME, language, cancellation, playback-end/error and fallback tests |
| Voice metallic post-processing | Server-side or pre-generated audio processing only | Browser Web Audio filters may be an optional effect; do not assume FFmpeg exists in Workers | Audio graph cleanup and clipping/latency tests |
| Speaker verification | Optional server-side speaker verification adapter with explicit opt-in and enrollment flow | Do not store raw voiceprints in localStorage or logs; require clear consent, retention and deletion policy | Consent, enrollment, threshold, spoofing limitation and deletion tests |
| Remote exit API | Authenticated session revoke/stop endpoint | Port only as a narrowly scoped, authenticated action; never expose arbitrary shell/process control | Authz, CSRF/origin, replay and idempotency tests |
| Flutter transparent HUD | Friday Canvas 2D HUD | Reimplement visual language in web-native Canvas; current design direction is the approved gold holographic sigil | Resize/DPR, reduced-motion, state mapping and mobile performance tests |
| Terminal/log overlay | Structured task/voice event feed | Port useful diagnostics without exposing tokens, transcripts or personal data by default | Redaction and bounded-retention tests |
| Control center / speaker management | Friday settings and profile controls | Browser UI only; OS-level permission controls remain browser/OS-owned | Keyboard, mobile layout, permission-state and accessibility checks |
| Desktop skills (browser-CDP, desktop-control) | Explicitly permissioned server-side tool adapters, if ever needed | Not executable from the browser; do not grant arbitrary desktop access to the web app | Tool allow-list, user confirmation, audit trail and sandbox tests |
| Custom assistants | Validated profile editor/import | Experimental until schema, prompt safety and server-side Agent allow-list are enforced | Invalid-config rejection and privilege-boundary tests |

## Current Friday baseline already present

The following components have been found in the development branch and should be extended rather than replaced:

- Voice controller with browser ASR, session IDs, resume scheduling and cleanup.
- TTS provider abstraction, browser playback and Piper-backed server route.
- VAD interruption controller with startup-failure cleanup.
- Agent state store and reducer with stale-session event rejection.
- DAG orchestrator, task runtime, event persistence and recovery primitives.
- Movie search/source/quality/review agent registry.
- Canvas-based gold HUD with responsive particle/frame budgets.

Before implementing a row, inspect the current implementation and tests on the target branch. Avoid creating a parallel controller or duplicate state machine.

## Delivery sequence

1. Foundation and inventory — keep this matrix current; identify existing interfaces and missing contracts.
2. Assistant profiles — typed profile schema, safe defaults, active profile persistence, deterministic switching.
3. Gateway adapter — server-only OpenClaw chat-completions/WebSocket strategy, Agent allow-list, authentication, timeouts and cancellation.
4. Conversation orchestration — profile-aware prompts, streaming responses, tool/event lifecycle and task-to-chat handoff.
5. Voice capability adapters — ASR/TTS contracts, permission-aware wake strategy, VAD ownership and interruption.
6. Speaker/security controls — opt-in verification, remote session revoke, consent and data minimization.
7. HUD and control center — profile-aware gold HUD states, diagnostics and accessible settings.
8. LibreTV integration — movie search, details, player controls and source workflows remain regression-safe.
9. Consolidated audit — unit/integration/security tests, build, CI, preview deployment, then iPhone Safari and desktop browser acceptance.

## Non-negotiable safety and release boundaries

- Work only on feature/friday-v3-runtime; never write to main.
- Keep PR #18 open and Draft; do not merge it.
- Do not deploy Production. Preview deployments must remain isolated.
- Gateway tokens, profile secrets and speaker embeddings must never enter client bundles, browser storage, logs or Git.
- Never claim desktop-grade always-on wake word, fully local ASR, biometric identity, or successful real-device behavior without corresponding implementation and test evidence.
- A green CI run is necessary but not sufficient. Mark device-only items as awaiting real-device verification until tested.
- Any upstream code copied or adapted must retain license obligations and must not weaken Friday's security model.

## Completion definition

A capability is complete only when all applicable items are true:

1. Implementation is integrated into Friday's existing architecture.
2. Inputs are validated and privileged operations remain server-side.
3. Success, failure, timeout, cancellation, duplicate and stale-event paths are handled.
4. Automated tests cover the contract and critical regressions.
5. CI is green on the latest branch head.
6. Device-dependent behavior is separately verified on target browsers/devices.
7. Documentation describes actual behavior and limitations accurately.