# LibreTV Autonomous UI Agent

## Product direction

The agent is operated through a dedicated visual UI Studio, not a chat-first interface, floating AI ball, or chat popup. The Studio provides project/page navigation, design references, task plans, file diffs, visual previews, evidence, and approval controls. The existing LibreTV site remains intact. Friday's AI/media runtime, APIs, tools, voice state machines, and player integration are independent of its floating presentation and must remain available.

## Design-system foundation

- Root `DESIGN.md` is the authoritative nine-part LibreTV visual contract.
- `docs/ui-agent/pages/` contains page-specific contracts that refine but cannot contradict the root contract.
- `design-library.md` maps VoltAgent/awesome-design-md references to principles; external brand files are research inputs, not themes to clone.
- `design-workflow.md` defines reference-to-token-to-implementation governance.
- `design-preview.md` defines the token/component catalog.
- Every task records design-system version, page-spec version, references, token changes, screenshots, and validation evidence.

## Agent roles

| Role | Responsibility | Output |
|---|---|---|
| Product/Scope Auditor | Inspect routes, existing behavior, protected modules, and task scope | Scope map and protected-file list |
| UI Auditor | Inspect components, styles, responsive behavior, accessibility | Baseline and defect list |
| Design Researcher | Select references and explain adaptation/rejection | Attributed reference notes |
| Design System Agent | Apply semantic tokens, typography, spacing, component rules | Token proposal/system delta |
| UX Designer | Define hierarchy, flows, states, viewport composition | Page specification |
| Frontend Engineer | Implement scoped UI changes | Code and focused tests |
| Visual QA Agent | Capture screenshots, inspect console/network, compare output | Visual evidence |
| Repair Agent | Fix confirmed root causes | Patch and retest evidence |
| Accessibility Auditor | Check semantics, contrast, keyboard, focus, motion, touch | Accessibility findings |
| Release Auditor | Verify CI, Preview commit, scope, approvals | Acceptance report |

## Runtime state machine

`DISCOVER -> LOAD_DESIGN_SYSTEM -> RESEARCH -> SPECIFY -> DESIGN -> IMPLEMENT -> INSPECT -> REPAIR -> VALIDATE -> APPROVAL -> REPORT`

Every stage emits a structured artifact and event. Retries are bounded. A failed stage cannot be reported complete. Production changes, PR merge, secrets, and infrastructure changes require explicit authorization.

## Core services

- **Repository adapter:** reads instructions, DESIGN.md, page specs, source, tests, scripts, branch/PR metadata.
- **Design reference adapter:** reads selected external references and records provenance.
- **Design knowledge base:** stores approved tokens, component recipes, page specs, decisions, reference screenshots.
- **Token/component registry:** exposes semantic roles, theme variants, component states, and versions.
- **Task orchestrator:** assigns specialist work, enforces dependencies, records status, bounded retries.
- **Browser runner:** records screenshots, console errors, failed requests, viewport/browser metadata.
- **Visual comparator:** compares current screenshots with approved references and design preview; pixel diff is diagnostic, not sole quality metric.
- **Repair loop:** turns confirmed findings into scoped patches and reruns impacted checks.
- **Evidence store:** stores commit, environment, viewport, theme, browser version, tests, screenshots, design-system version, Preview URL.
- **Policy gate:** blocks out-of-scope edits, secret access, production deploy, merge, and unapproved external actions.

## UI Studio workspace (visual, not conversational)

1. Project overview: branch, commit, health, active task, protected areas.
2. Page map: home, movies, anime, search, detail, player, My Space, settings, UI Studio.
3. Design library: curated reference search, preview, source/license provenance.
4. Design system: semantic tokens, typography, spacing, components, themes, page specs.
5. Design canvas: select page/region, attach reference, annotate defects and constraints.
6. Task planner: plan, affected files, risk, acceptance criteria, permissions.
7. File workspace: scoped tree, editor, diff, snapshots, rollback.
8. Live preview: route, viewport, theme, interactions.
9. Visual QA: screenshot comparison, geometry, console/network, accessibility.
10. Task center: stage progress, events, retry, pause/resume/cancel, logs, artifacts.
11. Release center: checks, Preview URL/commit, PR review, explicit approval.

Concise task descriptions and structured forms are allowed; the Studio is not a chat transcript.

## Design lifecycle

`REFERENCE -> EXTRACT -> ADAPT -> TOKENIZE -> SPECIFY -> PREVIEW -> IMPLEMENT -> COMPARE -> APPROVE -> VERSION`

References provide vocabulary and patterns. LibreTV requirements and approved page baselines decide what is accepted. Accepted decisions become semantic tokens/component/page rules. Implementations consume those rules; visual QA compares output to the approved contract. Changes are versioned with migration notes.

## Evidence classes

- `SOURCE`: source inspection.
- `UNIT`: unit/component tests.
- `BROWSER`: automated browser interaction.
- `VISUAL`: screenshot comparison.
- `PREVIEW`: deployed Preview URL and exact commit verified.
- `DEVICE`: physical device test.

These classes are not interchangeable. Desktop WebKit is not physical iPhone Safari; a successful build is not visual acceptance.

## Viewport matrix

| Target | Viewport | Themes | Checks |
|---|---:|---|---|
| Desktop | 1440x900 | Light + dark | Grid, header, navigation, keyboard |
| Tablet | 1024x1366 | Light + dark | Responsive transitions, touch, scroll |
| Phone | 390x844 | Light + dark | First-screen hierarchy, safe areas, overflow |

Add 375px/430px where wrapping is sensitive. Device-only behavior requires real-device evidence.

## Security and permissions

- Read-only inspection is default.
- Writes are limited to assigned feature branch and explicit scope.
- Browser tests use synthetic/test data.
- Never expose secrets in screenshots, logs, artifacts, or reports.
- No unrestricted shell, arbitrary egress, or production credentials for UI repair.
- No auto-merge, auto-release, or production deployment.
- Check provenance/license before committing reference assets.
