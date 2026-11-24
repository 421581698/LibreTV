/**
 * Friday Liquid Glass Engine — Assembly layer
 *
 * Composes the four layers into a single React mount used by LiquidGlassSurface.
 * Client-only: the engine is loaded lazily so SSR markup stays on the CSS
 * fallback (preserving the existing `data-liquid-glass-engine="fallback"` test
 * contract). Decorative layers are aria-hidden and pointer-events:none.
 *
 * Owns the full lifecycle: profile detection, canvas optical layer, visibility
 * gating, SVG augmentation, and clean teardown.
 */

'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { resolveMaterial, type GlassVariant } from './tokens';
import { detectProfile, withVisibility, type RuntimeProfile } from './adaptive-runtime';
import { createOpticalLayer, type OpticalHandle } from './canvas-layer';
import { createRefractionDefs, type SvgAugmentation } from './svg-layer';

export interface FridayGlassEngineProps {
  variant: GlassVariant | string | undefined;
  overLight?: boolean;
}

export default function FridayGlassEngine({ variant }: FridayGlassEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<OpticalHandle | null>(null);
  const [svg, setSvg] = useState<SvgAugmentation | null>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  useEffect(() => {
    const material = resolveMaterial(variant);
    const profile: RuntimeProfile = detectProfile();

    // Material -> CSS custom properties on the optical slot.
    setStyle({
      ['--friday-glass-blur' as string]: `${material.blur}px`,
      ['--friday-glass-edge' as string]: String(material.edgeLight),
    } as CSSProperties);

    // Layer 3: SVG refraction only for capable devices.
    if (profile.allowSvg) {
      setSvg(createRefractionDefs(Math.round(material.optical * 10), material.optical * 2));
    }

    // Layer 2: Canvas optical layer with visibility gating.
    const canvas = canvasRef.current;
    if (canvas && profile.allowCanvas) {
      const handle = createOpticalLayer(canvas, { material, profile });
      layerRef.current = handle;
      handle.start();

      let visible = true;
      const io = typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
          const next = entries.some((e) => e.isIntersecting);
          if (next !== visible) {
            visible = next;
            handle.setVisible(next);
            handle.setProfile(withVisibility(profile, next));
          }
        }, { threshold: 0.01 })
        : undefined;
      io?.observe(canvas);

      const onVisibility = () => {
        visible = !document.hidden;
        handle.setVisible(visible);
      };
      document.addEventListener('visibilitychange', onVisibility);

      return () => {
        io?.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        handle.destroy();
        layerRef.current = null;
      };
    }

    return () => {
      layerRef.current?.destroy();
      layerRef.current = null;
    };
  }, [variant]);

  return (
    <div className="friday-glass-engine" aria-hidden="true" style={style}>
      {svg ? <div className="friday-glass-svg" dangerouslySetInnerHTML={{ __html: svg.defs }} /> : null}
      <canvas ref={canvasRef} className="friday-glass-canvas" />
    </div>
  );
}
