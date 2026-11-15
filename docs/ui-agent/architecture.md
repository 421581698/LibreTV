# LibreTV Autonomous UI Agent

## Purpose

Provide a repeatable UI engineering loop that can inspect the current product, establish design intent, implement changes, capture browser evidence, compare results, repair defects, and report acceptance without silently changing unrelated product behavior.

## Agent roles

| Role | Responsibility | Output |
|---|---|---|
| UI Auditor | Inspect routes, components, styles, responsive breakpoints, accessibility, and current defects | Baseline inventory and defect list |
| Design System Agent | Extract/reuse tokens, typography, spacing, surfaces, states, and responsive rules | Design decisions and token proposal |
| UX Designer | Define hierarchy, user flows, empty/loading/error states, and viewport-specific composition | Acceptance criteria and page specification |
| Frontend Engineer | Implement the smallest scoped component/style changes | Code changes and focused tests |
| Visual QA Agent | Capture screenshots, inspect console/network, compare reference and current output | Visual evidence and defect report |
| Repair Agent | Fix confirmed root causes and repeat checks | Follow-up patch and re-test evidence |
| Release Auditor | Verify CI, Preview commit, and scope boundaries | Final acceptance report |

## Runtime architecture

The agent is orchestrated as a bounded state machine:

`DISCOVER -> SPECIFY -> DESIGN -> IMPLEMENT -> INSPECT -> REPAIR -> VALIDATE -> REPORT`

Each stage emits a structured artifact and an event. A stage may retry only within a configured retry budget. A failed stage cannot be reported as complete. Any action that changes production, merges a PR, changes secrets, or alters external infrastructure is outside the agent's default authority and requires explicit user authorization.

### Core services

- **Repository adapter:** reads repository instructions, source files, tests, package scripts, branch and PR metadata.
- **Task orchestrator:** assigns work, enforces stage dependencies, records status, and handles bounded retries.
- **Design knowledge base:** stores approved design tokens, page specifications, and reference screenshots with provenance.
- **Browser runner:** launches the supported browser matrix and records screenshots, console errors, failed requests, and viewport metadata.
- **Visual comparator:** compares current screenshots to approved references and flags material geometry/appearance differences. Pixel differences are diagnostic, not the sole quality score.
- **Repair loop:** converts confirmed findings into narrowly scoped changes and re-runs impacted checks.
- **Evidence store:** retains commit SHA, environment, viewport, theme, browser version, test output, screenshots, and Preview URL.
- **Policy gate:** prevents out-of-scope edits, secret access, production deployment, merge, and unapproved external actions.

## Evidence model

Every result must be tagged with its evidence class:

- `SOURCE`: source inspection only.
- `UNIT`: unit/component tests.
- `BROWSER`: automated browser interaction.
- `PREVIEW`: deployed Preview URL and exact commit verified.
- `DEVICE`: physical iPhone/iPad/desktop device test.

Evidence classes are not interchangeable. A successful build is not visual acceptance; Playwright WebKit is not physical iPhone Safari; a successful deployment is not proof of page behavior.

## Initial viewport matrix

| Target | Viewport | Themes | Required checks |
|---|---:|---|---|
| Desktop | 1440x900 | Light + dark | Grid, header, navigation, overlays, keyboard |
| Tablet | 1024x1366 | Light + dark | Responsive transitions, touch controls, scroll |
| Phone | 390x844 | Light + dark | First-screen hierarchy, safe areas, overflow, tap targets |

Add 375px and 430px phone widths when a page is especially sensitive to wrapping or compact layouts. Use real device screenshots for device-only behaviors.

## Security and permissions

- Read-only inspection is the default.
- Code writes are limited to the assigned feature branch and explicit task scope.
- Browser tests use synthetic/test data and test credentials only.
- Do not expose secrets in screenshots, logs, artifacts, or reports.
- Do not enable unrestricted shell, arbitrary network egress, or production credentials for UI repair.
- Do not auto-merge, auto-release, or deploy production.
