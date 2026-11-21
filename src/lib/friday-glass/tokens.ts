/**
 * Friday Liquid Glass Engine — Layer 1: Material Tokens
 *
 * Single source of truth for glass material parameters. Values map to the
 * existing --glass-* CSS custom properties so existing themes keep working;
 * the engine reads these as typed presets for the Canvas/SVG layers.
 *
 * No new dependency. Pure data.
 */

export type GlassVariant = 'dock' | 'control' | 'panel' | 'card' | 'field' | 'bar';

export interface GlassMaterial {
  /** Blur radius in px (CSS backdrop-filter). */
  blur: number;
  /** Saturation multiplier, 100 = unchanged. */
  saturation: number;
  /** Fill opacity 0..1 (light/dark theme handled by CSS vars). */
  fillAlpha: number;
  /** Border opacity 0..1. */
  borderAlpha: number;
  /** Corner radius in px. */
  radius: number;
  /** Inner top highlight opacity 0..1 (edge light). */
  edgeLight: number;
  /** Canvas optical strength 0..1 (reflection / flow amplitude). */
  optical: number;
}

/**
 * Presets tuned per surface role. Kept conservative: the optical layer is a
 * subtle enhancement behind real controls, never a replacement for the host
 * element's layout or semantics.
 */
export const GLASS_MATERIALS: Record<GlassVariant, GlassMaterial> = {
  dock: {
    blur: 40,
    saturation: 165,
    fillAlpha: 0.48,
    borderAlpha: 0.18,
    radius: 999,
    edgeLight: 0.14,
    optical: 0.55,
  },
  control: {
    blur: 2,
    saturation: 108,
    fillAlpha: 0.1,
    borderAlpha: 0.12,
    radius: 999,
    edgeLight: 0.1,
    optical: 0.28,
  },
  panel: {
    blur: 26,
    saturation: 155,
    fillAlpha: 0.76,
    borderAlpha: 0.16,
    radius: 20,
    edgeLight: 0.16,
    optical: 0.42,
  },
  card: {
    blur: 18,
    saturation: 145,
    fillAlpha: 0.58,
    borderAlpha: 0.14,
    radius: 18,
    edgeLight: 0.12,
    optical: 0.35,
  },
  field: {
    blur: 14,
    saturation: 130,
    fillAlpha: 0.42,
    borderAlpha: 0.14,
    radius: 14,
    edgeLight: 0.08,
    optical: 0.2,
  },
  bar: {
    blur: 22,
    saturation: 150,
    fillAlpha: 0.62,
    borderAlpha: 0.14,
    radius: 16,
    edgeLight: 0.12,
    optical: 0.32,
  },
};

/** Legacy preset names used by the current adapter, mapped to the new variants. */
export const LEGACY_VARIANT_MAP: Record<string, GlassVariant> = {
  dock: 'dock',
  control: 'control',
  panel: 'panel',
};

export function resolveMaterial(variant: GlassVariant | string | undefined): GlassMaterial {
  const key = (variant && LEGACY_VARIANT_MAP[variant]) || (variant as GlassVariant) || 'control';
  return GLASS_MATERIALS[key] ?? GLASS_MATERIALS.control;
}

/** Turn a material into inline CSS custom properties for the surface host. */
export function materialToCssVars(material: GlassMaterial): Record<string, string> {
  return {
    '--friday-glass-blur': `${material.blur}px`,
    '--friday-glass-saturate': `${material.saturation}%`,
    '--friday-glass-fill': String(material.fillAlpha),
    '--friday-glass-border': String(material.borderAlpha),
    '--friday-glass-radius': `${material.radius}px`,
    '--friday-glass-edge': String(material.edgeLight),
    '--friday-glass-optical': String(material.optical),
  };
}
