# LibreTV Design Preview Catalog

## Purpose

A visual reference for the current LibreTV design system. It is a diagnostic/reference surface, not a substitute for page-level browser acceptance.

## Required sections

1. Light/dark theme switch.
2. Semantic colors: canvas, surface, surface-raised, ink, ink-muted, line, accent, accent-contrast, success, warning, danger, focus.
3. Typography: display, H1, H2, H3, body, metadata, caption, control, code.
4. Spacing scale extracted from actual project tokens.
5. Shape/depth: radii, borders, shadows, overlay layers.
6. Components: buttons, icon buttons, navigation, inputs, cards, poster tiles, statuses, lists, task cards, diff states.
7. States: default, hover, focus, pressed, disabled, loading, error, selected.
8. Responsive examples: phone, tablet, desktop.
9. Accessibility: focus visibility, contrast, reduced motion, touch target dimensions.

## Source of truth

Read token values from actual CSS/theme implementation. Do not hardcode speculative hex or spacing values. Unresolved tokens must be marked unresolved and linked to an audit task. The preview must not become a second design system. Every shared token/component change updates the preview and screenshot evidence.

## Acceptance

Both themes render; every token maps to a real implementation token or is marked unresolved; component states are represented; no console errors, overflow, or inaccessible controls; desktop/tablet/phone screenshots are attached. Real-device acceptance is separate.
