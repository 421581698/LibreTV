'use client';

import { useEffect, useRef } from 'react';
import { useFridayGlass } from '@/components/friday/FridayGlassProvider';
import { detectProfile } from '@/lib/friday-glass/adaptive-runtime';
import { createOpticalLayer } from '@/lib/friday-glass/canvas-layer';
import { resolveMaterial, type GlassVariant } from '@/lib/friday-glass/tokens';
import type { GlassMaterial } from '@/lib/friday-glass/runtime';

/**
 * Restored Friday Canvas2D edge-light layer for native/WebKit glass.
 * No DOM pixel read, no media capture, no pointer interception, no geometry changes.
 * Restricted to small chrome to avoid expensive full-height drawer canvases.
 */
export function FridayNativeOptics({
  variant,
  material,
}: {
  variant: GlassVariant;
  material: GlassMaterial;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { backend, preferences, reducedMotion } = useFridayGlass();
  const enabled = (backend === 'webkit' || backend === 'native') &&
    !reducedMotion && preferences.intensity > 0 &&
    material !== 'solid' && material !== 'cinema';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;
    if (canvas.getBoundingClientRect().height > 240) return;
    const base = detectProfile();
    if (!base.allowCanvas) return;
    // Native optical illumination is decorative; never run the old 60 FPS
    // profile on navigation, even on a high-end iPad or desktop.
    const profile = {
      ...base,
      fps: Math.min(15, base.fps),
      dprCap: Math.min(1.25, base.dprCap),
      allowSvg: false,
    };
    const token = resolveMaterial(variant);
    const handle = createOpticalLayer(canvas, {
      material: { ...token, optical: token.optical * preferences.intensity / 100 },
      profile,
    });
    handle.start();
    const observer = typeof IntersectionObserver === 'undefined' ? null
      : new IntersectionObserver(entries => handle.setVisible(entries.some(entry => entry.isIntersecting)), {
        threshold: .01,
      });
    observer?.observe(canvas);
    const onVisibility = () => handle.setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      handle.destroy();
    };
  }, [enabled, preferences.intensity, variant]);

  if (!enabled) return null;
  return (
    <span className="friday-v12-canvas-wrap" aria-hidden="true">
      <canvas ref={canvasRef} className="friday-v12-canvas" />
    </span>
  );
}
