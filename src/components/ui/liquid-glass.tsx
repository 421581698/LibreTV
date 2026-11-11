'use client';

import { createElement, useEffect, useState, type ComponentType, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from 'react';

type LiquidGlassEngineProps = {
  children: ReactNode;
  displacementScale?: number;
  blurAmount?: number;
  saturation?: number;
  aberrationIntensity?: number;
  elasticity?: number;
  cornerRadius?: number;
  className?: string;
  padding?: string;
  style?: CSSProperties;
  overLight?: boolean;
  mode?: 'standard' | 'polar' | 'prominent' | 'shader';
};

type LiquidGlassSurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  children: ReactNode;
  interactive?: boolean;
};

type LiquidGlassComponent = ComponentType<LiquidGlassEngineProps>;

/**
 * Shared Liquid Glass adapter.
 * The upstream package reads navigator during render, so load it only after
 * mount to keep Next.js server rendering safe. The CSS surface remains the
 * immediate fallback and is also the Safari fallback for unsupported
 * displacement filters.
 */
export function LiquidGlassSurface({
  as = 'div',
  className = '',
  children,
  interactive = false,
  ...props
}: LiquidGlassSurfaceProps) {
  const [LiquidGlass, setLiquidGlass] = useState<LiquidGlassComponent | null>(null);

  useEffect(() => {
    let active = true;
    import('liquid-glass-react')
      .then((module) => {
        if (active) setLiquidGlass(() => module.default as LiquidGlassComponent);
      })
      .catch(() => {
        // Keep the CSS-first surface if the optional optical engine cannot load.
      });
    return () => {
      active = false;
    };
  }, []);

  const surface = createElement(
    as,
    {
      ...props,
      className: ['liquid-glass', interactive ? 'liquid-glass--interactive' : '', className]
        .filter(Boolean)
        .join(' '),
      'data-liquid-glass': 'true',
    },
    children,
  );

  if (!LiquidGlass) return surface;

  return (
    <LiquidGlass
      className="v4-mobile-tabbar-engine"
      displacementScale={18}
      blurAmount={0.8125}
      saturation={200}
      aberrationIntensity={1}
      elasticity={0.12}
      cornerRadius={999}
      padding="0"
      mode="standard"
    >
      {surface}
    </LiquidGlass>
  );
}
