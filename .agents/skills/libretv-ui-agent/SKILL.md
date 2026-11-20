---
name: libretv-ui-agent
description: Autonomous visual UI engineering skill for LibreTV, governed by root DESIGN.md and page contracts.
---

# LibreTV UI Agent

Operate through the dedicated visual UI Studio, not a floating assistant, chat popup, or conversational overlay. Deliver verified UI changes, not mockups.

## Mandatory design-system bootstrap

Before every UI task, read in order:
1. Repository instructions (`AGENTS.md` and local guidance).
2. Root `DESIGN.md` (authoritative nine-part LibreTV visual contract).
3. The target page contract under `docs/ui-agent/pages/`.
4. Relevant source, theme tokens, routes, data contracts, and tests.
5. `docs/ui-agent/design-library.md` for external reference research and `docs/ui-agent/design-workflow.md` for the decision lifecycle.

Record design-system version, page-spec version, target theme/viewports, approved references, protected modules, and acceptance criteria before coding.

## Non-negotiable boundaries

- Work only on the assigned feature branch; never commit to `main`.
- Never merge a PR or deploy production without explicit authorization for that exact action.
- UI Studio is a visual workspace, not a chat-first interface. Do not add a floating AI ball, floating chat window, or floating assistant entry.
- Preserve LibreTV pages, routes, navigation, player, APIs, recommendation data, persistence, and Friday voice/runtime/tools/player integration unless explicitly in scope.
- Removing Friday's floating presentation must not delete its backend/runtime/tooling.
- Do not fabricate content, posters, ratings, task progress, or validation evidence.
- CI, browser automation, Preview, and physical-device acceptance are separate evidence classes.
- Never claim physical iPhone/iPad validation from desktop browser tests.
- Avoid broad global selectors, unrelated file churn, and unapproved dependencies/services.
- External DESIGN.md files are attributed reference material, not permission to copy a complete brand identity or proprietary assets.

## DESIGN.md contract

The root DESIGN.md is authoritative for:
1. Visual theme and atmosphere.
2. Semantic color roles and values mapped from actual code.
3. Typography family, hierarchy, weights, line-height, and fallbacks.
4. Component styling and interaction states.
5. Layout, spacing, grids, and page composition.
6. Depth, elevation, borders, shadows, and z-index.
7. Do/don't guardrails and anti-patterns.
8. Responsive breakpoints, touch targets, safe areas, and collapse rules.
9. Agent prompt guide and implementation checklist.

Use semantic tokens, not arbitrary values. If a token is missing, propose it in the plan. Page contracts may refine but never contradict global accessibility, responsive, or safety rules. Existing approved page baselines take precedence over generic inspiration. Update DESIGN.md and the preview catalog when a reusable global rule changes; include rationale and migration notes.

## Reference research

Use design-library.md as a pattern library, not a one-click theme switcher. Select at most three primary references unless broader research is requested. Read each selected DESIGN.md and its light/dark preview. Extract general principles separately from brand-specific choices; mark each ADOPT, ADAPT, or REJECT; record source URL/path, rationale, LibreTV token mapping, conflicts, and evidence. Never automatically import an external brand palette or assets.

## Bounded operating loop

1. **Discover:** read instructions, DESIGN.md, page contract, source, tests, scripts, branch/PR scope; map protected modules and capture baseline.
2. **Specify:** define measurable layout, responsive, accessibility, and interaction criteria; record tokens/references and prohibited changes.
3. **Design:** define hierarchy, typography, color roles, spacing, surfaces, states, and responsive transitions. Update the token/component preview before implementation when reusable rules change.
4. **Implement:** make the smallest coherent scoped change; reuse existing components, theme handling, state ownership, and data contracts.
5. **Inspect:** capture same-route before/after screenshots at desktop 1440x900, tablet 1024x1366, phone 390x844, both themes; inspect console/network, overflow, clipping, safe areas, text wrapping, tap targets, and interactions.
6. **Repair:** fix root causes, repeat impacted checks, and stop at bounded retries.
7. **Validate:** run typecheck, lint, unit tests, build, focused browser tests, screenshot comparison, and Preview verification when available. Keep real-device checks pending until physically performed.
8. **Report:** list changed files, token changes, references and decisions, commit, test outputs, screenshots, Preview URL, limitations, and device checks.

## Quality gates

- No unintended horizontal overflow, clipping, overlap, or hidden primary action.
- Typography and spacing follow documented tokens.
- Light/dark themes remain legible.
- Focus is visible; controls are keyboard operable and named accessibly.
- Touch targets preferably >=44x44 CSS px.
- Fixed UI respects safe areas.
- Motion respects `prefers-reduced-motion`.
- Existing behavior is unchanged unless explicitly targeted.
- Every visual change maps to a page contract, token, or documented exception.
- No chat-first/floating assistant UI is introduced.

## Required final report

- Scope and baseline
- DESIGN.md and page-spec versions
- Reference sources and ADOPT/ADAPT/REJECT decisions
- Design/token decisions
- Implementation and changed files
- Automated checks (PASS/FAIL/NOT RUN)
- Desktop/tablet/phone and light/dark results
- Preview URL and exact commit (or NOT AVAILABLE)
- Real iPhone/iPad checks (PASS/FAIL/NOT RUN)
- Remaining risks

Never label an item PASS without direct evidence.
