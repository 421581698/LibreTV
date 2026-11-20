# UI Agent Design Reference Library

## Purpose

Use [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) as a curated source of agent-readable design analyses. The collection provides DESIGN.md files and paired light/dark preview catalogs. Its value is structured design reasoning, not wholesale brand cloning.

Upstream: https://github.com/VoltAgent/awesome-design-md  
License: MIT. Retain the upstream copyright/license notice when redistributing substantial copied material. This file primarily links to upstream references.

## Nine dimensions to inspect

1. Visual theme and atmosphere.
2. Semantic color palette and roles.
3. Typography hierarchy.
4. Component styles and interaction states.
5. Layout, spacing, grids, containers.
6. Depth, elevation, borders, surfaces.
7. Do/don't guardrails.
8. Responsive breakpoints and touch behavior.
9. Agent prompt guide.

Inspect `preview.html` and `preview-dark.html` where available. A screenshot alone is not a complete design contract.

## Curated reference map

| Reference | Pattern to study | LibreTV adaptation boundary |
|---|---|---|
| [Runway](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/runwayml) | Cinematic media composition and art direction | Only where it supports media discovery; preserve approved homepage baseline |
| [Spotify](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/spotify) | Artwork-led browsing and media rails | Adapt navigation/content patterns, not branding or palette |
| [Apple](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/apple) | Whitespace, typography restraint, clarity | Reference for clarity, not global restyle |
| [Linear](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/linear.app) | Precise controls and workspace density | UI Studio operational surfaces, not media pages by default |
| [Vercel](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/vercel) | Technical dashboard and deployment status | Status/diagnostic patterns only |
| [Cursor](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/cursor) | Developer workspace and file-oriented interaction | Workspace structure; not chat-centric interface |
| [Figma](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/figma) | Canvas, inspector, selection patterns | Visual editing affordances only |
| [Raycast](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/raycast) | Compact action surfaces | Action menus only |
| [ElevenLabs](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/elevenlabs) | Voice waveform/audio status | Only if a voice-status surface is explicitly in scope |

## Selection protocol

For each task, select no more than three primary references unless broader research is requested. Read their DESIGN.md and preview variants. Extract principles separately from brand-specific values. Mark each item ADOPT, ADAPT, or REJECT. Record source URL, exact path, rationale, LibreTV token/component mapping, conflicts, and evidence. Never automatically replace LibreTV tokens with an external brand palette. Do not copy logos, proprietary illustrations, screenshots, or brand assets as implementation assets.

## Decision record

| Field | Required value |
|---|---|
| Task/page | Exact route/component |
| Upstream source | URL and source path |
| Pattern | Principle being studied |
| Decision | ADOPT / ADAPT / REJECT |
| LibreTV mapping | Tokens/components affected |
| Conflict check | Existing page baseline and constraints |
| Evidence | Preview, screenshot, implementation, test |
| Approval | Reviewer and decision state |

Do not silently sync the entire upstream collection. Revisit selected references when a task needs them and re-check current content and license.
