/**
 * Friday Liquid Glass — semantic surface primitives.
 *
 * These wrappers keep page components declarative and ensure every glass
 * surface uses the shared material tokens and the same adaptive engine.
 * They intentionally do not own page layout, data, or interaction behavior.
 */
'use client';

import { forwardRef, type HTMLAttributes } from 'react';
import { LiquidGlassSurface } from '@/components/ui/liquid-glass';

type GlassContainerProps = HTMLAttributes<HTMLDivElement>;

function createGlassPrimitive(
  displayName: string,
  variant: 'dock' | 'control' | 'panel' | 'card' | 'field' | 'bar',
  role: string,
  baseClass: string,
) {
  const Primitive = forwardRef<HTMLDivElement, GlassContainerProps>(
    function FridayGlassPrimitive({ className = '', ...props }, ref) {
      return (
        <LiquidGlassSurface
          {...props}
          ref={ref}
          as="div"
          variant={variant}
          className={[`friday-glass-${baseClass}`, className].filter(Boolean).join(' ')}
          data-friday-glass-role={role}
        />
      );
    },
  );
  Primitive.displayName = displayName;
  return Primitive;
}

/** General content card; suitable for movie metadata and grouped content. */
export const GlassCard = createGlassPrimitive('GlassCard', 'card', 'card', 'card');

/** Elevated, denser surface for dialogs, sheets, and popovers. */
export const GlassPanel = createGlassPrimitive('GlassPanel', 'panel', 'panel', 'panel');

/** Compact toolbar / header strip. */
export const GlassBar = createGlassPrimitive('GlassBar', 'bar', 'bar', 'bar');

/** Floating dock surface. */
export const GlassDock = createGlassPrimitive('GlassDock', 'dock', 'dock', 'dock');

/** Low-emphasis field container; place native inputs inside it. */
export const GlassField = createGlassPrimitive('GlassField', 'field', 'field', 'field');

/** Small control grouping surface; native controls remain real DOM controls. */
export const GlassControl = createGlassPrimitive('GlassControl', 'control', 'control', 'control');
