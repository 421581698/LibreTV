'use client';

import {
  createElement,
  forwardRef,
  useEffect,
  useState,
  type ComponentType,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';

type Point = { x: number; y: number };
type GlassMode = 'standard' | 'polar' | 'prominent' | 'shader';
type SurfaceVariant = 'dock' | 'control' | 'panel';

type EngineProps = {
  children: ReactNode;
  displacementScale?: number;
  blurAmount?: number;
  saturation?: number;
  aberrationIntensity?: number;
  elasticity?: number;
  cornerRadius?: number;
  globalMousePos?: Point;
  mouseOffset?: Point;
  mouseContainer?: RefObject<HTMLElement | null> | null;
  className?: string;
  padding?: string;
  style?: CSSProperties;
  overLight?: boolean;
  mode?: GlassMode;
};

type SurfaceProps = Omit<HTMLAttributes<HTMLElement>, 'color'> & {
  as?: ElementType;
  children?: ReactNode;
  interactive?: boolean;
  variant?: SurfaceVariant;
  displacementScale?: number;
  blurAmount?: number;
  saturation?: number;
  aberrationIntensity?: number;
  elasticity?: number;
  cornerRadius?: number;
  globalMousePos?: Point;
  mouseOffset?: Point;
  mouseContainer?: RefObject<HTMLElement | null> | null;
  padding?: string;
  overLight?: boolean;
  mode?: GlassMode;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
  value?: string;
  form?: string;
};

type EngineComponent = ComponentType<EngineProps>;

const presets: Record<SurfaceVariant, Omit<EngineProps, 'children' | 'className' | 'style'>> = {
  dock: {
    displacementScale: 18,
    blurAmount: 0.08,
    saturation: 165,
    aberrationIntensity: 0.7,
    elasticity: 0,
    cornerRadius: 999,
    padding: '0',
    mode: 'standard',
  },
  control: {
    displacementScale: 12,
    blurAmount: 0.07,
    saturation: 150,
    aberrationIntensity: 0.45,
    elasticity: 0,
    cornerRadius: 999,
    padding: '0',
    mode: 'standard',
  },
  panel: {
    displacementScale: 14,
    blurAmount: 0.08,
    saturation: 145,
    aberrationIntensity: 0.5,
    elasticity: 0,
    cornerRadius: 20,
    padding: '0',
    mode: 'standard',
  },
};

/** Shared host surface: semantic content/layout stays in the host; optics are decorative. */
export const LiquidGlassSurface = forwardRef<HTMLElement, SurfaceProps>(function LiquidGlassSurface(
  {
    as = 'div',
    className = '',
    children,
    interactive = false,
    variant = 'control',
    displacementScale,
    blurAmount,
    saturation,
    aberrationIntensity,
    elasticity,
    cornerRadius,
    globalMousePos,
    mouseOffset,
    mouseContainer,
    padding,
    overLight,
    mode,
    style,
    ...props
  }: SurfaceProps,
  ref,
) {
  const [Engine, setEngine] = useState<EngineComponent | null>(null);

  useEffect(() => {
    let mounted = true;
    import('liquid-glass-react')
      .then((module) => {
        if (mounted) setEngine(() => module.default as EngineComponent);
      })
      .catch(() => {
        // Keep the semantic surface usable if the optical engine cannot load.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const preset = presets[variant];
  const canHostEngine = as !== 'button' && as !== 'a' && as !== 'span';
  const engineProps: EngineProps = {
    children: createElement('span', {
      className: 'liquid-glass-engine-fill',
      'aria-hidden': true,
    }),
    ...preset,
    displacementScale: displacementScale ?? preset.displacementScale,
    blurAmount: blurAmount ?? preset.blurAmount,
    saturation: saturation ?? preset.saturation,
    aberrationIntensity: aberrationIntensity ?? preset.aberrationIntensity,
    elasticity: elasticity ?? preset.elasticity,
    cornerRadius: cornerRadius ?? preset.cornerRadius,
    padding: padding ?? preset.padding,
    overLight: overLight ?? false,
    mode: mode ?? preset.mode,
    globalMousePos,
    mouseOffset,
    mouseContainer,
    className: 'liquid-glass-engine-root',
    style: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    },
  };

  return createElement(
    as,
    {
      ...props,
      ref,
      style: padding === undefined ? style : { ...style, padding },
      className: [
        'liquid-glass',
        interactive ? 'liquid-glass--interactive' : '',
        className,
      ].filter(Boolean).join(' '),
      'data-liquid-glass': 'true',
      'data-liquid-glass-engine': Engine && canHostEngine ? 'ready' : 'fallback',
    },
    Engine && canHostEngine
      ? createElement('span', { className: 'liquid-glass-engine-slot', 'aria-hidden': true }, createElement(Engine, engineProps))
      : null,
    children,
  );
});
