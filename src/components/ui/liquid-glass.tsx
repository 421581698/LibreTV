'use client';

import {
  createElement,
  forwardRef,
  useEffect,
  useState,
  type ComponentType,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { resolveMaterial, materialToCssVars, type GlassMaterial } from '@/lib/friday-glass/tokens';

type EngineProps = {
  variant?: string;
  overLight?: boolean;
};

type SurfaceVariant = 'dock' | 'control' | 'panel' | 'card' | 'field' | 'bar';
type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  children?: ReactNode;
  interactive?: boolean;
  variant?: SurfaceVariant;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
  value?: string;
  form?: string;
};
type EngineComponent = ComponentType<EngineProps>;

/**
 * LibreTV Liquid Glass v2.0 surface, powered by the in-house
 * Friday Liquid Glass Engine (CSS material + Canvas 2D optical + optional SVG
 * refraction + adaptive runtime). Replaces the previous `liquid-glass-react`
 * dependency without changing any call site.
 *
 * The semantic/control element stays the real outer DOM node; the engine is a
 * non-interactive optical layer behind children and never alters host layout.
 * The engine is loaded lazily in an effect, so SSR markup stays on the CSS
 * fallback (`data-liquid-glass-engine="fallback"`) — preserving the existing
 * rendering contract.
 */
export const LiquidGlassSurface = forwardRef<HTMLElement, SurfaceProps>(function LiquidGlassSurface({
  as = 'div',
  className = '',
  children,
  interactive = false,
  variant = 'control',
  ...props
}: SurfaceProps, ref) {
  const [Engine, setEngine] = useState<EngineComponent | null>(null);

  useEffect(() => {
    let mounted = true;
    import('@/lib/friday-glass/engine')
      .then((module) => {
        if (mounted) setEngine(() => module.default as EngineComponent);
      })
      .catch(() => {
        // The surface remains usable; the CSS material layer is the fallback.
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Phrasing-only hosts keep the CSS fallback: block-level canvas layers are
  // invalid inside button/a/span and would break those controls' layout.
  const canHostEngine = as !== 'button' && as !== 'a' && as !== 'span';
  const material: GlassMaterial = resolveMaterial(variant);
  const engineReady = !!Engine && canHostEngine;
  const opticalLayer = engineReady ? (
    <div className="liquid-glass-engine-slot" aria-hidden="true">
      <Engine variant={variant} />
    </div>
  ) : null;

  return createElement(
    as,
    {
      ...props,
      ref,
      className: [
        'liquid-glass',
        'friday-glass',
        interactive ? 'liquid-glass--interactive' : '',
        className,
      ].filter(Boolean).join(' '),
      style: { ...materialToCssVars(material), ...(props.style || {}) },
      'data-liquid-glass': 'true',
      'data-liquid-glass-engine': engineReady ? 'friday-engine' : 'fallback',
      'data-friday-glass': material.optical > 0 ? 'optical' : 'static',
    },
    opticalLayer,
    children,
  );
});
