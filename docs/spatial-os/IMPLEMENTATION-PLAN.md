# Spatial OS V1.0 implementation and acceptance plan

## Scope
Implement the spatial presentation layer while preserving all existing Friday V3 runtime, Canvas renderer, player engines, quality probe, agent DAG and FMHY independence.

## Work packages

0. Compatibility audit and ownership map.
1. SpatialStateStore with versioned Spatial State; Session State and Task State remain separate.
2. FridayCore adapter that consumes existing runtime events and forwards six visual states to the existing Canvas engine.
3. SpatialPortal and SpatialRouter with in-app activation/history, no Next.js navigation.
4. IntelligencePortal with live task projections from existing task events and DAG outcomes.
5. CinematicPortal composed around existing recommendation, VOD and live player components.
6. ResourcePortal with recursively ingested FMHY root taxonomy and nested Streaming resources.
7. TaskProjection and QualityVerifier with provenance-separated source claims and decoded-height evidence.
8. ResponsiveScene for desktop, iPad and iPhone; reduced-motion and constrained-device rendering.
9. Regression, accessibility, performance and CI acceptance.

## Acceptance gates

### Architecture
- Exactly one production owner for the existing Friday Canvas 2D renderer.
- No new ASR/TTS/VAD controller.
- No replacement task runtime or DAG scheduler.
- No new media engine.
- No Next.js route transition when switching spatial containers.
- Spatial/Session/Task state have separate schemas and write paths.

### Functional
- Friday remains accessible in all four spaces and yields visual focus when playback/resources are primary.
- Six visual states are projected correctly from existing runtime events.
- Panels can expand, collapse, focus and coexist without covering critical playback controls.
- Switching spaces restores each space's layout and scroll state.
- Task views recover from event-store snapshots/checkpoints and do not invent task progress.
- FMHY root categories and Streaming hierarchy retain canonical source links.
- Quality UI distinguishes source-declared, probed-stream and player-decoded evidence.

### Responsive and performance
- Keyboard focus and screen-reader labels exist for all space/panel controls.
- Reduced-motion preference disables nonessential motion.
- Mobile particle/render quality is reduced without changing runtime behavior.
- Playback controls remain reachable at phone and tablet widths.
- No unbounded animation loop or duplicate Canvas renderer.

### Test and release
- Add unit tests for stores, router, state projection, panel focus, resource parsing and evidence precedence.
- Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` through repository CI.
- CI green is not equivalent to iPhone Safari hardware acceptance.
- No merge to `main` or production deployment without separate explicit approval.
