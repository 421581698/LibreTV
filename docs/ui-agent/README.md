# LibreTV UI Agent

The UI Agent is a scoped autonomous UI engineering workflow for LibreTV.

Start with [the skill instructions](../../.agents/skills/libretv-ui-agent/SKILL.md), then follow the [architecture](./architecture.md) and [acceptance contract](./acceptance.md).

## Current delivery boundary

This initial package defines the agent's role, stage machine, evidence model, visual quality gates, and safety policy. It does not claim that a browser runner, screenshot comparator, persistent evidence database, or self-healing execution service has already been installed. Those runtime capabilities must be implemented and verified in subsequent code stages.

## Suggested task input

Provide:
- target route/page and exact scope
- desired visual reference or written outcome
- allowed files/components
- required viewports and themes
- existing behavior that must not change
- acceptance gates and Preview environment

The agent must return a baseline before editing and an evidence-based report after validation.
