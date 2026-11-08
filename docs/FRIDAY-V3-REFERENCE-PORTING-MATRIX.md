# Friday V3 — Reference Project Porting Matrix

> Status: architecture and migration decision record  
> Updated: 2026-11-08  
> Target: current `main` integration baseline (`dba11d31e972b3bf3a0053ba19a84c7e11f2b1d9`); implement and validate future changes on isolated feature branches

This matrix records what Friday should learn from the four reviewed repositories. It is a selective porting plan, not a dependency-import plan. None of the four projects is a drop-in replacement for the existing Next.js/React application.

## 1. Executive decision

| Reference | Primary contribution | Friday destination | Port decision |
|---|---|---|---|
| [JarvisAgent](https://github.com/myismu/JarvisAgent) | Agent task pipeline, scheduling, permissions, context/memory, rollback concepts | Agent planner, task policy, orchestration and audit layer | Port concepts and typed contracts; do not import its desktop runtime |
| [Cypher-AI](https://github.com/pattanayakpratik/Cypher-AI) | HUD composition, animated core, audio-reactive visualization, speech feedback | FridayOrb / visual cockpit / Web Audio visualization | Reimplement in Canvas/WebGL/CSS; do not embed PyQt |
| [jarvis_ai](https://github.com/eadmin2/jarvis_ai) | Streaming audio, WebSocket transport, ASR pipeline, interruption/barge-in | Voice transport adapters and interruption coordinator | Prototype as an optional web voice transport; preserve browser-native fallback |
| [Assistant-X-OpenClaw](https://github.com/rubintry/assistant-x-openclaw) | Audio lifecycle supervision, stream-stall detection, local ASR/TTS, multi-assistant routing | Voice lifecycle state machine, recovery diagnostics, assistant profiles | Port lifecycle patterns; do not import desktop Python/Flutter or privileged Gateway scopes |

## 2. Capability-to-module mapping

| Friday module | Adopt | Adaptation required | Explicitly out of scope |
|---|---|---|---|
| Agent planner and DAG | JarvisAgent's staged execution, dependency scheduling, checkpoint and rollback ideas | Use the existing `TaskDefinition`, `TaskRuntime`, `runFridayDag`, typed agent inputs/outputs and browser-local event store; define policy before adding autonomous planning | Importing a separate desktop agent manager or allowing unrestricted shell/browser actions |
| Tool authorization | JarvisAgent's permission boundaries | Add a server-enforced allowlist, per-tool schemas, user confirmation for consequential actions, and audit records | Trusting model-generated tool names or client-only permission checks |
| Orb/HUD | Cypher-AI's layered core, rings, ticks, telemetry and sound-reactive feedback | Rebuild as the existing Friday Canvas core, with device-aware DPR, reduced-motion and low-power fallback | PyQt5, QPainter, or copying Cypher's blue Arc Reactor palette |
| Audio visualization | Cypher-AI's spectrum/telemetry idea | Use Web Audio `AnalyserNode` from the active audio graph; visualization must not own microphone or ASR lifecycle | Treating amplitude as a transcript or as proof that ASR is alive |
| ASR transport | jarvis_ai's PCM streaming and WebSocket pattern | Define a transport interface, permission lifecycle, sample-rate/channel contract, reconnect and backpressure policy; test Safari separately | Assuming a Python Whisper process or WebSocket automatically works in iOS Safari |
| Barge-in | jarvis_ai's interruptible audio pipeline | One interruption coordinator owns TTS cancellation, capture ownership, request abort and session generation IDs | Starting a second microphone stream while the first stream is still active |
| Voice lifecycle | Assistant-X's stream-stall watchdog, start/stop supervision and recovery model | Add observable transitions and bounded recovery to the browser voice controller; distinguish silence from missing audio frames | Reusing CoreAudio/sounddevice watchdog thresholds in a browser |
| Local speech models | Assistant-X's sherpa-onnx / Piper / VITS / MeloTTS options | Evaluate only if a separately deployed inference service or supported browser runtime is available; preserve current TTS provider contract | Bundling large native desktop models into the web client by default |
| Multi-assistant | Assistant-X's profile separation | Keep profiles as configuration over the same safe tool registry and session lifecycle | Giving profiles different unrestricted system permissions |
| Memory/context | JarvisAgent's context compaction and memory concepts | Separate short-lived conversation context, task event history and explicit user-approved durable preferences | Persisting secrets, voiceprints or sensitive conversation payloads without a clear need and retention policy |

## 3. Friday target architecture

```text
LibreTV UI / Friday Conversation
  ├─ Existing /api/chat + GLM provider + SSE/UI message stream
  ├─ Existing movie result cards and friday-open-detail bridge
  └─ Friday task/voice presentation
       |
       +-- Voice Controller
       |    ├─ Browser ASR adapter (current compatibility path)
       |    ├─ Optional streaming ASR transport (future, gated)
       |    ├─ TTS adapter
       |    ├─ VAD / interruption coordinator
       |    └─ lifecycle diagnostics + bounded recovery
       |
       +-- Task Service
       |    ├─ TaskRuntime + append-only event store
       |    ├─ DAG orchestrator
       |    ├─ policy / cancellation / retry coordinator
       |    └─ task history and recovery UI
       |
       +-- LibreTV domain adapters
            ├─ /api/chat search_movie result handoff
            ├─ /api/search for explicit independent search use-cases
            ├─ /api/quality for source-side resolution probing
            ├─ existing detail modal bridge
            └─ existing player and playback APIs
```

The existing LibreTV movie search remains the source of truth. Friday's workflow consumes its actual results; it must not create a parallel search catalogue or replace the homepage search pipeline.

## 4. Porting sequence and acceptance gates

1. **Agent safety and runtime:** define typed inputs/outputs, tool allowlists, dependency validation, event ordering, cancellation and retry policy. A task is not considered retryable merely because a UI offers a retry button.
2. **Real data adapters:** use actual LibreTV search and quality endpoints. Preserve source IDs and VOD IDs end-to-end. Never infer resolution from a provider's advertised label.
3. **Voice lifecycle:** instrument start, result, end, error, abort, TTS start/stop and session retirement. Verify repeated user-gesture starts on physical iPhone Safari.
4. **Voice transport experiment:** compare current browser recognition with optional PCM/WebSocket ASR behind a feature flag. Measure latency, interruption, network loss, privacy and cost before choosing a default.
5. **HUD:** drive orb animation from explicit voice/task states and audio analysis; animation must never own business state.
6. **Regression:** run typecheck, lint, unit tests, homepage/detail/player regression tests and preview deployment checks before merge.

## 5. Security and privacy guardrails

- Keep production and `main` untouched during feature work.
- Never expose model credentials, provider tokens, or Gateway secrets to the browser.
- Do not copy Assistant-X's `operator.admin`-style broad scopes into Friday. Use the minimum server-side capability per action.
- Require explicit user gesture for microphone capture; do not silently resume capture after reload.
- Voiceprints, camera frames and local speech models are optional, privacy-sensitive capabilities and are not part of the default Friday V3 scope.
- Keep browser-local task persistence local. A shared task store requires a separately approved server binding, retention policy and privacy review.
- A source-side HLS resolution measurement is not the same as the decoded playback element's actual `videoHeight`.
- Never report unmeasured source latency, quality, availability or task progress.

## 6. Source repositories

- JarvisAgent: https://github.com/myismu/JarvisAgent
- Cypher-AI: https://github.com/pattanayakpratik/Cypher-AI
- jarvis_ai: https://github.com/eadmin2/jarvis_ai
- Assistant-X-OpenClaw: https://github.com/rubintry/assistant-x-openclaw