import { createElement, type ElementType, type HTMLAttributes, type ReactNode } from 'react';

type LiquidGlassSurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  children: ReactNode;
  interactive?: boolean;
};

/**
 * Shared CSS-first Liquid Glass surface.
 * Uses native backdrop filtering plus restrained optical edge highlights;
 * it deliberately avoids displacement/WebGL so iOS Safari stays reliable.
 */
export function LiquidGlassSurface({
  as = 'div',
  className = '',
  children,
  interactive = false,
  ...props
}: LiquidGlassSurfaceProps) {
  return createElement(
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
}
