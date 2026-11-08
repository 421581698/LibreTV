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

## V3.4 implementation baseline
The current V3.4 delivery scope, nine workstreams, preserved contracts, and CI acceptance rules are tracked in [FRIDAY-V3.4-IMPLEMENTATION.md](./FRIDAY-V3.4-IMPLEMENTATION.md).


## V3.5 — workflow reliability and safe replay

V3.5 builds directly on the merged V3.4 baseline. It does not change the selected gold holographic orb, homepage entry, voice lifecycle, LibreTV search/detail/player contracts, or browser-local storage boundary.

Delivered reliability work:
- Add a task snapshot read API so the DAG can distinguish new, successful, failed, cancelled, and active persisted tasks.
- Add explicit DAG replay mode. Successful dependency outputs are reused; only failed tasks with persisted retryable errors can be replayed.
- Propagate retryability to dependent tasks only when the failed prerequisite is itself retryable.
- Keep side-effect tasks blocked from automatic and explicit replay; active/cancelled tasks require a new execution identity.
- Preserve retryable status after the automatic attempt budget is exhausted so the user can explicitly retry from the workflow UI.
- Bound replay requests to four per task to prevent unbounded loops.
- Expose a “Retry failed steps” action only for a workflow whose failed tasks are eligible for safe replay.
- Add parentTaskId lineage across search, source probe, quality and review tasks.
- Strengthen review to reject missing, duplicate, orphaned and incorrectly evidenced candidate assessments. “Assessment complete” now requires exactly one completed assessment per candidate.

CI acceptance remains the user-approved gate: both `prelaunch-checks` and `friday-2.2-verify` must pass TypeScript, ESLint, unit tests and production build. No production deployment is part of V3.5.

## Non-negotiable safeguards
- Use current main as the integration base; keep all V3.4 changes on `feature/friday-v3.4-complete-upgrade` until CI acceptance.
- Do not alter the selected gold holographic orb design or replace its established interaction path.
- Never fabricate task progress, source latency, resolution, player state, or agent results.
- Replay is an audit event; external side-effect tasks are blocked from automatic replay.
- Never auto-start microphone capture outside a direct user gesture.
- Preserve existing search, detail modal, player, and /api/chat contracts.
- User acceptance for this V3.4 delivery is CI-green only: TypeScript, ESLint, unit tests, and production build. No preview or production deployment is implied.


## Persistence decision

The first durable adapter uses the existing Dexie/IndexedDB database. This makes task history survive page reloads on the same browser without adding an unconfigured Cloudflare binding or changing production infrastructure. It is browser-local, not cross-device or server-side persistence. Event writes are transactional, event IDs and per-task sequence numbers are unique, and the adapter rejects gaps. Task data may include prompts and source metadata, so it stays in the user's browser. A future shared/server audit store requires an explicitly provisioned D1 or equivalent binding, retention policy, and privacy review.


## V3.7 — DAG and lineage integrity

V3.7 tightens graph validation before any persisted task is created or agent is executed:
- Reject duplicate dependency edges and malformed dependency/parent identifiers.
- Reject self-parent references and cycles in in-graph parent lineage while allowing an external parent request ID.
- Reject duplicate or empty Agent registrations rather than silently allowing Map insertion order to shadow an Agent.
- Preserve the distinction between execution dependencies (`dependsOn`) and audit lineage (`parentTaskId`).
- Keep all validation deterministic and covered by unit tests; no UI, orb, voice, player, or deployment changes.

