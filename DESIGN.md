---
version: 1.0.0
name: LibreTV Design System
description: Product-owned visual language for LibreTV, a cinematic media discovery and playback experience.
---

# LibreTV DESIGN.md

This is the authoritative visual contract for LibreTV and its UI Agent. It follows the nine-part DESIGN.md structure used by VoltAgent/awesome-design-md, but defines an original LibreTV system rather than copying an external brand. Existing approved page baselines remain authoritative.

## 1. Visual Theme & Atmosphere

LibreTV is media-first: cinematic discovery, fast browsing, clear hierarchy, and unobtrusive playback. The interface should feel curated, immersive without sacrificing navigation, and precise rather than ornamental.

- Real content and poster artwork are the visual focus; controls support discovery.
- Use whitespace, alignment, typography, and image composition before decoration.
- Keep home, movies, anime, search, detail, player, My Space, settings, and UI Studio coherent.
- This file is a consistency layer, not authorization to redesign every page.
- UI Studio is a dedicated visual engineering workspace, not a chat window, floating assistant, or AI orb.

## 2. Color Palette & Roles

Map the current CSS/theme variables to these semantic roles. Do not invent or globally replace hex values based on this prose.

| Semantic role | Responsibility |
|---|---|
| canvas | Main page background |
| surface | Primary content surface |
| surface-raised | Elevated panels, menus, popovers |
| ink | Primary text |
| ink-muted | Secondary text and metadata |
| line | Borders and dividers |
| accent | Primary actions and active states only |
| accent-contrast | Accessible foreground on accent |
| success / warning / danger | Semantic status and error states |
| focus | Visible keyboard focus indicator |

Use semantic roles, not raw hex values. Accent is intentional, not a decorative wash. Light/dark themes map to the same roles. Maintain WCAG AA contrast where applicable. Unresolved mappings must be audited against actual theme code.

## 3. Typography Rules

Use the existing project font stack until a font migration is approved.

| Level | Role |
|---|---|
| Display | Reserved for page-level editorial moments |
| H1 | One clear page title |
| H2 | Section title |
| H3 | Card/group title |
| Body | Main readable copy |
| Metadata | Year, genre, runtime, status |
| Caption | Helper text, never illegibly small |
| Control | Buttons, tabs, inputs |
| Code | UI Studio paths, diffs, logs |

Sizes, weights, line heights, and letter spacing must be implemented as tokens. Truncate only secondary metadata. Respect narrow viewport wrapping and user font scaling.

## 4. Component Stylings

All components consume semantic tokens and define relevant states.

| Component | Required states |
|---|---|
| Primary/secondary/icon buttons | hover, focus, pressed, disabled, loading |
| Navigation | active, hover, focus |
| Poster tile | loading, unavailable, hover/focus |
| Search input | empty, typing, focused, error |
| Content card | hover/focus, selected |
| Dialog/drawer | open, closing, focus management, escape |
| Toast/status | success, warning, error |
| UI Studio task card | queued, running, blocked, failed, complete |
| Diff viewer | additions, deletions, selected file, review |
| Preview frame | loading, disconnected, failed |

Do not use a modal or chat overlay as the primary UI Studio workspace. Use full-page workspace regions and task panels.

## 5. Layout Principles

- Preserve each page's approved information architecture unless explicitly changed.
- Audit and reuse the existing spacing scale; do not create a competing scale.
- Keep text containers readable and avoid stretching dense text across very wide screens.
- Poster grids prioritize real artwork, consistent ratios, and predictable responsive columns.
- Keep first-screen hierarchy focused; oversized hero regions must not hide essential content.
- UI Studio desktop: project/page navigation, central visual work area, contextual preview/inspector. Mobile: one focused work surface with preview/diff in separate panels.
- Prefer grid/flex and intrinsic sizing over absolute positioning.

## 6. Depth & Elevation

Use a restrained hierarchy: base canvas, bordered surface, raised surface, explicit overlay. Player controls may use contrast-safe scrims over video. Define z-index layers centrally. Avoid nested shadows, excessive blur, glowing borders, and decorative glass that harms readability or performance.

## 7. Do's and Don'ts

**Do:** use real API-backed content; preserve player, Friday runtime, APIs, persistence and navigation; reuse theme tokens; design responsive and interaction states; provide focus and reduced-motion support; record decisions and exceptions.

**Don't:** fabricate posters; rewrite business logic for screenshots; delete Friday runtime when removing its floating UI; add chat-first or floating assistant UI to UI Studio; clone an external brand or copy its assets; introduce random gradients/oversized cards by default; use broad global CSS selectors; claim validation without evidence.

## 8. Responsive Behavior

Required viewports: phone 390x844 (also 375/430 when needed), tablet 1024x1366, desktop 1440x900.

- Mobile is not a shrunken desktop: prioritize primary actions and content.
- Respect safe-area insets for fixed elements.
- Touch targets preferably at least 44x44 CSS px.
- No unintended horizontal scrolling, clipping, overlap, or hidden primary actions.
- Adapt poster columns while preserving artwork ratios.
- UI Studio mobile uses focused panels, not a compressed desktop dashboard.
- Test light and dark themes at all required sizes.
- Real iPhone/iPad Safari acceptance is separate from automated browser tests.

## 9. Agent Prompt Guide

Before changing UI, read this file and the relevant page contract; inspect actual tokens and approved screenshots; identify protected modules; attribute references; plan token choices, responsive rules, states, and acceptance checks; implement only within scope; capture before/after evidence.

> Build the requested LibreTV page using root DESIGN.md and its page-specific contract. Reuse semantic tokens and existing components. Preserve protected routes, data sources, player behavior, Friday runtime, and persistence. Do not introduce chat or floating assistant UI. Validate desktop, tablet, phone, light/dark, accessibility, and interactions. Report only evidence-backed results.

## Versioning

Current version 1.0.0. Global rules require a version update and migration note. Page-specific refinements belong in `docs/ui-agent/pages/`. Token values must be synchronized with actual theme code after inspection; this document does not authorize speculative replacement.
