'use client';

import {
  createElement,
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';

import { FridayOpticalBoundary } from '@/components/friday/FridayOpticalBoundary';
import { FridayNativeOptics } from '@/components/friday/FridayNativeOptics';
import { useFridayGlass } from '@/components/friday/FridayGlassProvider';
import type { GlassMaterial } from '@/lib/friday-glass/runtime';

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
  /** Disable the optional optical renderer when a stable CSS-only surface is required. */
  disableEngine?: boolean;
  variant?: SurfaceVariant;
  material?: GlassMaterial;
  ambientTone?: 'light' | 'dark';
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
let opticalModule: Promise<EngineComponent> | undefined;

function loadOpticalRenderer() {
  opticalModule ??= import('liquid-glass-react')
    .then((module) => module.default as EngineComponent)
    .catch((error: unknown) => {
      opticalModule = undefined;
      throw error;
    });
  return opticalModule;
}

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
    disableEngine = false,
    variant = 'control',
    material,
    ambientTone,
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
  const { backend, preferences, reducedMotion, reportFailure } = useFridayGlass();
  // Global material selection must also affect panels and the iPad drawer.
  const activeMaterial = material ?? preferences.material;
  const canHostEngine = backend === 'optical' && activeMaterial !== 'solid' &&
    activeMaterial !== 'cinema' && preferences.intensity > 0 && !disableEngine &&
    variant !== 'control' &&
    as !== 'button' && as !== 'a' && as !== 'span';
  // Expensive continuously animated Canvas is reserved for the compact navigation dock.
  // Other surfaces retain GPU-backed CSS rim highlights and transparency.
  const canHostNativeOptics = variant === 'dock' &&
    as !== 'button' && as !== 'a' && as !== 'span';
  const intensity = preferences.intensity / 100;
  const [Engine, setEngine] = useState<EngineComponent | null>(null);
  const [shortEdge, setShortEdge] = useState<number | null>(null);
  const opticalSlot = useRef<HTMLSpanElement>(null);
  const engineReady = Boolean(Engine && canHostEngine);

  useEffect(() => {
    const slot = opticalSlot.current;
    if (!engineReady || !slot || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setShortEdge(Math.min(width, height));
    });
    observer.observe(slot);
    return () => observer.disconnect();
  }, [engineReady]);

  useEffect(() => {
    if (!canHostEngine) return;
    let mounted = true;
    loadOpticalRenderer()
      .then((component) => {
        if (mounted) setEngine(() => component);
      })
      .catch(() => {
        if (mounted) reportFailure();
      });
    return () => {
      mounted = false;
    };
  }, [canHostEngine, reportFailure]);

  const preset = presets[variant];
  const radius = cornerRadius ?? preset.cornerRadius ?? 0;
  const effectiveRadius = shortEdge === null ? radius : Math.min(radius, shortEdge / 2);
  const geometryScale = shortEdge === null ? 1 : Math.min(1, shortEdge / 48);
  const engineProps: EngineProps = {
    children: createElement('span', {
      className: 'liquid-glass-engine-fill',
      'aria-hidden': true,
    }),
    ...preset,
    displacementScale: (displacementScale ?? preset.displacementScale ?? 0) * intensity * geometryScale,
    blurAmount: blurAmount ?? preset.blurAmount,
    saturation: saturation ?? preset.saturation,
    aberrationIntensity: (aberrationIntensity ?? preset.aberrationIntensity ?? 0) * intensity,
    elasticity: reducedMotion ? 0 : elasticity ?? preset.elasticity,
    cornerRadius: effectiveRadius,
    padding: padding ?? preset.padding,
    overLight: overLight ?? (preferences.ambient && ambientTone === 'light'),
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
      'data-friday-material': activeMaterial,
      'data-friday-ambient': preferences.ambient ? ambientTone : undefined,
      'data-liquid-glass-engine': engineReady ? 'ready' : 'fallback',
    },
    Engine && canHostEngine
      ? (
        <span ref={opticalSlot} className="liquid-glass-engine-slot" aria-hidden="true">
          <FridayOpticalBoundary onFailure={reportFailure}>
            <Engine {...engineProps} />
          </FridayOpticalBoundary>
        </span>
      )
      : null,
    canHostNativeOptics ? <FridayNativeOptics variant={variant} material={activeMaterial} /> : null,
    children,
  );
});
