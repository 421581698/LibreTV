import { describe, expect, it } from 'vitest';
import {
  GLASS_MATERIALS,
  resolveMaterial,
  materialToCssVars,
  type GlassVariant,
  GLASS_ROLE_VARIANTS,
  isGlassVariant,
} from './tokens';
import { detectProfile, withVisibility, type RuntimeProfile } from './adaptive-runtime';
import { createRefractionDefs } from './svg-layer';

describe('Friday Liquid Glass Engine — tokens (Layer 1)', () => {
  it('defines a material preset for every supported variant', () => {
    const variants: GlassVariant[] = ['dock', 'control', 'panel', 'card', 'field', 'bar'];
    for (const v of variants) {
      const m = GLASS_MATERIALS[v];
      expect(m).toBeDefined();
      expect(m.blur).toBeGreaterThanOrEqual(0);
      expect(m.fillAlpha).toBeGreaterThan(0);
      expect(m.fillAlpha).toBeLessThanOrEqual(1);
      expect(m.optical).toBeGreaterThanOrEqual(0);
    }
  });

  it('resolves legacy and unknown variants safely', () => {
    expect(resolveMaterial('dock')).toBe(GLASS_MATERIALS.dock);
    expect(resolveMaterial('card')).toBe(GLASS_MATERIALS.card);
    expect(resolveMaterial('nonsense')).toBe(GLASS_MATERIALS.control);
    expect(resolveMaterial(undefined)).toBe(GLASS_MATERIALS.control);
  });


  it('maps semantic UI roles to canonical material presets', () => {
    expect(GLASS_ROLE_VARIANTS.popover).toBe('panel');
    expect(GLASS_ROLE_VARIANTS.movieCard).toBe('card');
    expect(GLASS_ROLE_VARIANTS.search).toBe('field');
    expect(GLASS_ROLE_VARIANTS.navigation).toBe('bar');
    expect(resolveMaterial('toolbar')).toBe(GLASS_MATERIALS.bar);
    expect(resolveMaterial('input')).toBe(GLASS_MATERIALS.field);
  });

  it('recognizes only canonical glass variants', () => {
    expect(isGlassVariant('card')).toBe(true);
    expect(isGlassVariant('popover')).toBe(false);
    expect(isGlassVariant('unknown')).toBe(false);
  });

  it('emits CSS custom properties from a material', () => {
    const vars = materialToCssVars(GLASS_MATERIALS.panel);
    expect(vars['--friday-glass-blur']).toBe(`${GLASS_MATERIALS.panel.blur}px`);
    expect(vars['--friday-glass-optical']).toBe(String(GLASS_MATERIALS.panel.optical));
  });
});

describe('Friday Liquid Glass Engine — adaptive runtime (Layer 4)', () => {
  function env(overrides: Record<string, unknown> = {}) {
    return {
      navigator: { hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, ...overrides } as unknown as Navigator,
      matchMedia: ((q: string) => ({ matches: q.includes('prefers-reduced-motion') ? false : false })) as never,
      devicePixelRatio: 3,
    };
  }

  it('gives high-end desktop a full tier with capped DPR', () => {
    const p = detectProfile(env());
    expect(p.tier).toBe('full');
    expect(p.dprCap).toBeLessThanOrEqual(2);
    expect(p.allowCanvas).toBe(true);
    expect(p.allowSvg).toBe(true);
  });

  it('degrades reduced-motion users to minimal and disables SVG', () => {
    const e = env();
    e.matchMedia = ((q: string) => ({ matches: q.includes('prefers-reduced-motion') })) as never;
    const p = detectProfile(e);
    expect(p.reducedMotion).toBe(true);
    expect(p.tier).toBe('minimal');
    expect(p.allowSvg).toBe(false);
  });

  it('turns the optical layer off for save-data', () => {
    const e = env({ connection: { saveData: true } });
    const p = detectProfile(e);
    expect(p.tier).toBe('off');
    expect(p.allowCanvas).toBe(false);
    expect(p.fps).toBe(0);
  });

  it('caps mobile GPUs one notch', () => {
    const p = detectProfile(env({ maxTouchPoints: 1 }));
    expect(p.tier).toBe('balanced');
  });

  it('downgrades off-screen surfaces', () => {
    const full: RuntimeProfile = detectProfile(env());
    const hidden = withVisibility(full, false);
    expect(hidden.fps).toBeLessThan(full.fps);
    expect(hidden.allowSvg).toBe(false);
    expect(withVisibility(full, true)).toBe(full);
  });
});

describe('Friday Liquid Glass Engine — SVG augmentation (Layer 3)', () => {
  it('produces a unique, bounded refraction filter', () => {
    const a = createRefractionDefs(6, 1.2);
    const b = createRefractionDefs(6, 1.2);
    expect(a.filterId).not.toBe(b.filterId);
    expect(a.defs).toContain(`id="${a.filterId}"`);
    expect(a.defs).toContain('feDisplacementMap');
    expect(a.defs).toContain('feMerge');
  });

  it('clamps out-of-range scale/dispersion', () => {
    const defs = createRefractionDefs(999, 999).defs;
    expect(defs).toContain('scale="24"');
    expect(createRefractionDefs(-5, -5).defs).toContain('scale="0"');
  });
});
