# Friday Liquid Glass — Phase 2 Material System

Phase 2 turns the Phase 1 engine into a reusable surface vocabulary. It does not automatically restyle every route; page-by-page adoption is the next integration step.

## Canonical materials

| Material | Intended use | Notes |
| --- | --- | --- |
| `dock` | floating dock / bottom navigation | high blur, pill radius |
| `control` | compact control groups | low fill and blur |
| `panel` | dialogs, sheets, popovers | elevated fill and shadow |
| `card` | movie cards and content cards | balanced fill and optical strength |
| `field` | search and form field containers | focus-within treatment |
| `bar` | header bars and toolbars | horizontal chrome |

Legacy aliases such as `popover`, `dialog`, `toolbar`, and `input` resolve to canonical presets. Use canonical variants in new code.

## React primitives

Import from `@/components/ui/friday-glass`:

- `GlassCard`
- `GlassPanel`
- `GlassBar`
- `GlassDock`
- `GlassField`
- `GlassControl`

Example:

```tsx
import { GlassCard, GlassField, GlassBar } from '@/components/ui/friday-glass';

<GlassBar className="px-4 py-3">
  {/* Keep existing navigation controls and handlers unchanged. */}
</GlassBar>

<GlassField className="p-2">
  <input aria-label="Search" className="w-full bg-transparent outline-none" />
</GlassField>

<GlassCard className="overflow-hidden">
  {/* Existing poster, title, metadata, and actions. */}
</GlassCard>
```

## Rules

1. Keep semantic controls as real buttons, links, inputs, and navigation elements. A glass surface is decoration, not a replacement for semantics.
2. Do not blur video, poster, image, or canvas media. Apply glass only to UI chrome and containers.
3. Do not add route-specific behavior to these primitives. They only provide material.
4. Keep event handlers, focus behavior, keyboard navigation, and player logic on the existing controls.
5. Use `interactive` only on `LiquidGlassSurface` when the surface itself is genuinely clickable.
6. The engine optical slot is behind content and pointer-inert; CSS material remains available if the client engine cannot mount.
7. Respect reduced motion and reduced transparency. Mobile/coarse-pointer cards avoid hover-only affordances.

## Phase 2 scope

Included: canonical material roles, semantic React wrappers, interaction/focus states, reduced-transparency handling, and token tests.

Not included: bulk replacement of every existing page component, visual acceptance on physical iPhone/iPad devices, or production deployment.
