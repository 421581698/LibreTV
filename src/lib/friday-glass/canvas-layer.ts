/**
 * Friday Liquid Glass Engine — Layer 2: Canvas 2D Optical Layer
 *
 * Renders dynamic reflection, edge light and a slow travelling highlight on a
 * non-interactive canvas behind real controls. Zero dependency. Instance-based
 * lifecycle (create -> start/stop/setVisible/destroy) mirrors friday-orb-core
 * so behavior is familiar and leak-free.
 *
 * The layer is decorative only (aria-hidden). It never captures pointer input
 * and never replaces the host element's layout.
 */

import type { GlassMaterial } from './tokens';
import type { RuntimeProfile } from './adaptive-runtime';

export interface OpticalHandle {
  start(): void;
  stop(): void;
  setVisible(visible: boolean): void;
  setMaterial(material: GlassMaterial): void;
  setProfile(profile: RuntimeProfile): void;
  destroy(): void;
  readonly running: boolean;
}

interface CreateOptions {
  material: GlassMaterial;
  profile: RuntimeProfile;
}

/**
 * Create an optical canvas layer bound to `canvas`.
 * Sizes the backing store with a capped DPR and responds to element resize.
 */
export function createOpticalLayer(canvas: HTMLCanvasElement, options: CreateOptions): OpticalHandle {
  let { material, profile } = options;
  let ctx = canvas.getContext('2d', { alpha: true });
  let frame = 0;
  let running = false;
  let visible = true;
  let width = 0;
  let height = 0;
  let startTs = 0;
  let lastDrawTs = 0;
  let observer: ResizeObserver | undefined;

  const dpr = () => Math.max(1, Math.min(profile.dprCap, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));

  function resize() {
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const nextW = Math.max(1, Math.round(rect.width * dpr()));
    const nextH = Math.max(1, Math.round(rect.height * dpr()));
    if (nextW !== width || nextH !== height) {
      width = canvas.width = nextW;
      height = canvas.height = nextH;
    }
  }

  function draw(ts: number) {
    frame = requestAnimationFrame(draw);
    if (!ctx || !running) return;

    // Throttle to the target fps by elapsed time (stable, no recursive ticks).
    const interval = profile.fps > 0 ? 1000 / profile.fps : 1000;
    if (lastDrawTs && ts - lastDrawTs < interval) return;
    lastDrawTs = ts;

    if (!startTs) startTs = ts;
    const t = (ts - startTs) / 1000;
    const w = width;
    const h = height;
    ctx.clearRect(0, 0, w, h);

    const strength = material.optical * (profile.tier === 'minimal' ? 0.45 : 1);
    if (strength <= 0 || w < 2 || h < 2) return;

    // Edge light: a soft top-down gradient hugging the glass rim.
    const edge = ctx.createLinearGradient(0, 0, 0, h);
    edge.addColorStop(0, `rgba(255,255,255,${(material.edgeLight * strength).toFixed(3)})`);
    edge.addColorStop(0.35, 'rgba(255,255,255,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);

    // Reflection: a broad diagonal sheen that slowly traverses the surface.
    const phase = profile.reducedMotion ? 0.25 : (Math.sin(t * 0.35) * 0.5 + 0.5);
    const x1 = -w * 0.4 + phase * w * 1.8;
    const sheen = ctx.createLinearGradient(x1, 0, x1 + w * 0.55, h);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, `rgba(255,255,255,${(0.12 * strength).toFixed(3)})`);
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);

    // Travelling highlight: a thin moving band near the top edge.
    if (profile.tier === 'full') {
      const hx = ((t * 0.12) % 1) * w;
      const band = ctx.createLinearGradient(hx - w * 0.15, 0, hx + w * 0.15, 0);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.5, `rgba(255,255,255,${(0.1 * strength).toFixed(3)})`);
      band.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, w, Math.max(2, Math.round(h * 0.08)));
    }

  }

  return {
    start() {
      if (running || !ctx || !profile.allowCanvas) return;
      running = true;
      lastDrawTs = 0;
      resize();
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => resize());
        observer.observe(canvas);
      }
      frame = requestAnimationFrame(draw);
    },
    stop() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
    setVisible(next: boolean) {
      visible = next;
      if (!visible) this.stop();
      else this.start();
    },
    setMaterial(next: GlassMaterial) { material = next; },
    setProfile(next: RuntimeProfile) {
      const wasRunning = running;
      profile = next;
      if (!next.allowCanvas && wasRunning) this.stop();
      else if (next.allowCanvas && !wasRunning && visible) this.start();
    },
    destroy() {
      this.stop();
      observer?.disconnect();
      ctx = null;
    },
    get running() { return running; },
  };
}
