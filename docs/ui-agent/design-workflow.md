# DESIGN.md Lifecycle and Governance

## Lifecycle

`DISCOVER -> REFERENCE -> EXTRACT -> ADAPT -> TOKENIZE -> SPECIFY -> PREVIEW -> IMPLEMENT -> COMPARE -> APPROVE -> VERSION`

1. **Discover:** identify page/route, component, viewport, theme, user task, protected modules, current tokens, and baseline screenshot.
2. **Reference:** select sources from design-library.md; read DESIGN.md and light/dark previews; record URL and date checked.
3. **Extract/adapt:** separate general principles from brand-specific values; map patterns to LibreTV semantic roles; mark ADOPT/ADAPT/REJECT and explain conflicts.
4. **Tokenize:** audit actual CSS/theme values; record additions, deprecations, aliases, and migrations; never globally change tokens as a side effect of a page task.
5. **Specify:** define purpose, hierarchy, regions, tokens, states, responsive behavior, accessibility, data provenance, protected logic, and acceptance matrix.
6. **Preview:** render semantic colors, type scale, spacing, components, and states in light/dark. The catalog must share the implementation token source where feasible.
7. **Implement:** use existing components and semantic tokens; keep player, Friday, APIs, persistence, and navigation outside visual refactors unless explicitly authorized.
8. **Compare/repair:** compare same viewport/theme before and after; inspect geometry, wrapping, poster ratios, contrast, overflow, focus, safe areas, and interactions; fix root causes.
9. **Approve/version:** human approval for global token changes, broad redesigns, and releases; update root DESIGN.md for global rules and page specs for local rules; retain commit, screenshots, tests, and Preview evidence.

## Conflict precedence

1. Explicit current user instruction.
2. Existing approved LibreTV page baseline and product constraints.
3. Root LibreTV DESIGN.md.
4. Page-specific contract (must refine, not contradict, root rules).
5. Approved component implementation and existing tokens.
6. External reference systems.
7. Agent aesthetic preference.

## Change classes

| Class | Example | Approval |
|---|---|---|
| Local | One component state/spacing correction | Task scope |
| Page | Layout/typography within one page | Page acceptance |
| System | Shared tokens/global components | Explicit design-system review |
| Product-wide | Navigation/shared shell/cross-page redesign | Explicit user approval |
| Protected logic | Player, Friday runtime, APIs, persistence | Explicit user approval and separate tests |
| Release | Merge, production deploy, secrets/infrastructure | Explicit authorization for exact action |

## Rollback

Keep a known-good branch/commit checkpoint. If visual repair regresses protected behavior or exceeds scope, revert the smallest offending change and report it.
