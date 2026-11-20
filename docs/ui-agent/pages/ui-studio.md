# UI Studio Page Contract

- Purpose: visual control center for autonomous UI design and engineering.
- Interaction model: project/page navigation, visual canvas, task cards, file diff, live preview, logs, approval controls. No chat transcript, floating assistant, or floating AI orb.
- Core regions: project overview; page map; reference library; design tokens/specs; design canvas; task planner; file workspace; preview; visual QA; task center; release center.
- Workflow: discover -> load design system -> research -> specify -> design -> implement -> inspect -> repair -> validate -> approval -> report.
- Capability truth: show connected/disconnected/blocked states for repository, model, sandbox, browser, and Preview. Never fake an executing agent or claim file writes/tests unless backend evidence exists.
- Permissions: read-only by default; writes only to assigned feature branch and approved files; no arbitrary shell, secrets, main writes, merge, or production deploy.
- Responsive: desktop uses project navigation + central canvas + inspector/preview; mobile focuses one panel at a time and opens preview/diff separately.
- Acceptance: task planning, approval gates, real file diffs, responsive preview, accessible controls, truthful service status, no chat UI.
