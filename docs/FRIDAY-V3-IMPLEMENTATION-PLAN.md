# Friday V3 implementation plan

## What we learn from the reference projects

### HomeRail
- Adopt explicit voice lifecycle boundaries and cockpit-style state presentation.
- Adopt typed agent inputs/outputs and DAG orchestration concepts.
- Study ASR/TTS integration and generative UI contracts.
- Do not import its self-hosted Manager/Worker runtime wholesale into this Next.js application.

### Assistant-X-OpenClaw
- Study shader-driven orb, metaballs, HUD composition, speech interruption, and audio-effect pipeline.
- Reimplement the visual layer for the web with WebGL2/Three.js rather than copying Flutter shader code.
- Keep wake-word and speaker-verification features optional and privacy-sensitive.

## Target architecture

1. Friday UI: conversation, voice cockpit, task timeline, responsive orb.
2. Voice engine: ASR, TTS, VAD adapters, interruption coordinator, browser capability fallbacks.
3. Agent orchestrator: planner plus typed agents connected by a validated DAG.
4. Task runtime: snapshots, append-only events, checkpoints, cancellation, retry, safe replay.
5. Storage adapter: durable event persistence behind a small interface.
6. LibreTV adapters: existing movie search, source discovery, source probing, quality metadata, detail modal, player controls.

## Delivery order

### Phase 1 — Task runtime and event contract
- Define task/event types, lifecycle transitions, DAG validation, checkpoint semantics, replay safety.
- Test cycle rejection, lifecycle transitions, event reconstruction, side-effect replay blocking.
- Add durable storage only after deployment bindings and retention policy are verified.

### Phase 2 — DAG orchestration
- Planner produces a typed graph.
- Search, source-probe, and quality-analysis agents have isolated contracts.
- Dependencies gate execution; failures and retries are visible.
- Review agent validates evidence before Friday reports results.
- Never invent latency, resolution, or availability data.

### Phase 3 — Voice engine
- Preserve the existing useFridayVoiceController and its user-gesture entry point.
- Add ASR/TTS/VAD adapters without assuming browser Web Speech support is uniform.
- Verify iPhone Safari permission, start/stop, interruption, resume, and cleanup.
- TTS interruption must cancel speech and avoid duplicate recognition instances.

### Phase 4 — Cockpit and orb
- Task timeline is driven only by runtime events.
- Rebuild orb as real-time WebGL2 with background sampling, Fresnel response, refraction, and restrained bloom.
- Keep a low-power fallback for devices without WebGL2 or with reduced motion.

## Non-negotiable safeguards
- main and production remain untouched during development.
- Keep fix/friday-orb-clean PR #17 draft isolated.
- All V3 work happens on feature/friday-v3-runtime.
- Never fabricate task progress, source latency, resolution, or agent results.
- Replay is an audit event; external side-effect tasks are blocked from automatic replay.
- Never auto-start microphone capture outside a direct user gesture.
- Preserve existing search, detail modal, player, and /api/chat contracts.
- Merge only after CI is green, a real Preview URL is verified, and iPhone Safari behavior is manually accepted.
