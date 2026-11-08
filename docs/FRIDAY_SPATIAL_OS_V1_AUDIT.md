# FRIDAY SPATIAL OS V1.0 — Phase 0 Architecture Audit

**Audit target:** `feature/friday-spatial-os-v1` / PR #54  
**Baseline:** LibreTV · FRIDAY SPATIAL OS · UI Baseline V1.0  
**Audit scope:** application composition, spatial hierarchy, navigation ownership, panel lifecycle, visual-state projection, and persistence model.  
**Status:** Findings confirmed from source inspection. This is an audit, not a visual acceptance sign-off.

## Executive finding

The current implementation is a **legacy homepage wrapped by a spatial-themed shell**, not yet a spatial operating system. The mismatch is structural: the root component stacks the Friday hero, panel toolbar, four-space navigation, and the full legacy homepage in normal document flow. CSS cannot resolve this hierarchy without changing component ownership and the state model.

## Confirmed findings

| Severity | Area | Evidence | Consequence |
|---|---|---|---|
| Critical | Root composition | `FridaySpatialOS.tsx` renders core → `SpatialPanelWorkspace` → four-space nav → active portal. The cinematic portal simply wraps `children`. | Spatial UI and legacy homepage are vertically concatenated instead of composed as one environment. |
| Critical | Legacy chrome leakage | `page.tsx` passes `Header` and the full homepage tree as Cinematic children. `Header` still renders theme, history, download, settings and search controls even with `minimalFridayNav`. | Duplicate navigation and old controls remain visible inside the new OS. |
| Critical | Navigation duplication | `SpatialPanelWorkspace` exposes six global panel buttons; `FridaySpatialOS` exposes four space buttons plus a back button; Header exposes its own controls. | No single owner for primary navigation; functional concepts are repeated at multiple levels. |
| High | Space geometry | `.spatial-os-nav` is a four-column grid in normal flow. | Four spaces are tabs/cards, not corner/around-core spatial anchors. |
| High | No spatial activation lifecycle | Space buttons only call `activate()`; the active portal swaps below the navigation. There is no enter/expand/return transition or retained spatial container surface. | A selected space changes content but does not open as a spatial container. |
| High | Panel ownership | `SpatialSnapshot` has one global `focusedPanel` and `expandedPanel`; the toolbar is always visible. | Panels are global floating windows rather than tools owned by a space/task context. |
| High | Panel semantics | `quality` and `tasks` both render `IntelligencePortal`. | Two separate controls lead to the same surface; panel responsibilities are not distinct. |
| High | Cinematic responsibility | `CinematicPortal` is a pass-through wrapper; homepage search/recommendations/player remain in the child tree. | Cinematic is not an independently controlled immersive container. |
| High | Persistence model | Store persists active space, one focused/expanded panel, panel rects, history, scroll and generic filters. It has no active presentation mode, per-space panel ownership, focus context, or versioned cross-tab conflict revision. | It cannot faithfully restore a multi-space workspace or resolve concurrent updates deterministically. |
| Medium | Error state | `FridayHero` displays the error string as the same orb label; CSS adds a red glow to the core. | ERROR is not a distinct calm/recovery presentation and competes visually with the active core animation. |
| Medium | Mobile hierarchy | Space labels are truncated in a four-column grid; toolbar/back controls consume additional vertical space. | Narrow viewports amplify the stacking and hierarchy problems. |

## Root cause

The implementation started by mounting existing features inside a new wrapper. It did not first define the spatial composition contract. As a result:
1. The page tree still owns homepage chrome and content.
2. The spatial shell owns another set of navigation and panels.
3. The state store models a page with selected tabs and a single modal-like panel, rather than a persistent spatial workspace.

## Frozen product rules to enforce

1. Friday is persistent, but its visual prominence is contextual; it must not reserve a fixed oversized hero region in every space.
2. The four spaces are primary spatial anchors, not a horizontal tab bar.
3. The default composition is a central gold-sigil core with four corner/arc space anchors.
4. Opening a space transitions into its container; it does not append another section below the core.
5. Functional tools belong to their owning space. Search belongs to Intelligence; search results and playback belong to Cinematic; source discovery belongs to Resource Universe; personal preferences/history belong to Identity. Quality and task execution are projections in Intelligence/Task surfaces, not duplicate global navigation.
6. The Cinematic space owns recommendations, search results and player presentation. Legacy Header chrome must not leak into the default Spatial OS shell.
7. Friday visual state and task state are separate dimensions. ERROR must be calm, visibly recoverable, and must not masquerade as THINKING/EXECUTING.
8. Preserve the existing Friday voice controller, ASR/TTS/VAD lifecycle, Canvas 2D gold-sigil renderer, Task Runtime, player, decoded-quality evidence, and real recommendation/resource data sources.

## Phase 1 — SpatialStateStore redesign contract

Before changing the visual shell, the state model must explicitly represent:
- `activeSpace`: current spatial container.
- `presentation`: `lobby | space | task` (default lobby).
- `spaceStates`: per-space expansion/scroll/selected-item state.
- `panelStack`: panels owned by a space, with focus/order/layout and minimized state; no global six-button toolbar.
- `taskContext`: optional task/agent context projected from the existing Task Runtime, never a second runtime.
- `navigation`: bounded internal history with safe browser History API markers.
- `revision` and `originId`: deterministic cross-tab last-writer ordering, while keeping local persistence local.
- Migration from current V2 workspace state without losing existing scroll, panel layout, or filters.

The store must remain presentation-only: it must not start/stop voice capture, TTS, playback, or Agent tasks. Those lifecycles remain owned by their existing runtime modules.

## Implementation order

1. Complete this audit and keep it committed as the source-of-truth diagnosis.
2. Implement and test the new state schema, migration, reducers, navigation and cross-tab conflict handling.
3. Rebuild the lobby composition and space-container transitions around that store.
4. Move legacy homepage features into their owning spaces and remove duplicate global chrome.
5. Add browser-level acceptance for mobile and desktop; only then tune animation and visual polish.

## Explicit non-goals

- No production deployment or main-branch changes.
- No rewrite of Friday V3 voice, Canvas renderer, Task Runtime, player, or media-source APIs.
- No replacement of real recommendation/resource data with mock content.
- No claim of iPhone Safari acceptance from unit tests or CI alone.
