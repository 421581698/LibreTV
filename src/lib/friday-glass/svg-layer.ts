/**
 * Friday Liquid Glass Engine — Layer 3: SVG Refraction Augmentation
 *
 * Optional, high-tier only. Produces inline SVG filter definitions that add a
 * subtle displacement (refraction) and chromatic dispersion at glass edges.
 * The filter is rendered as a non-interactive layer; hosts reference it by id.
 *
 * Kept deliberately weak and gated by the Adaptive Runtime — SVG filters can
 * be expensive, so minimal/low-power devices never create them.
 */

export interface SvgAugmentation {
  /** Unique filter id for this surface. */
  filterId: string;
  /** Inline SVG markup defining the filter. */
  defs: string;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `friday-glass-fx-${seq}`;
}

/**
 * Build a refraction + dispersion filter def.
 * `scale` is the displacement strength (px); `dispersion` the RGB split (px).
 */
export function createRefractionDefs(scale = 6, dispersion = 1.2): SvgAugmentation {
  const filterId = nextId();
  const s = Math.max(0, Math.min(24, scale));
  const d = Math.max(0, Math.min(4, dispersion));
  const defs = [
    `<svg aria-hidden="true" class="friday-glass-svg-defs" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden">`,
    `<defs>`,
    `<filter id="${filterId}" x="-10%" y="-10%" width="120%" height="120%">`,
    `<feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="1" seed="7" result="noise"/>`,
    `<feDisplacementMap in="SourceGraphic" in2="noise" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="refracted"/>`,
    d > 0
      ? `<feOffset in="refracted" dx="${d}" dy="0" result="rShift"/>`
        + `<feOffset in="refracted" dx="${-d}" dy="0" result="bShift"/>`
        + `<feMerge in="refracted"><feMergeNode in="rShift"/><feMergeNode in="refracted"/><feMergeNode in="bShift"/></feMerge>`
      : '',
    `</filter>`,
    `</defs>`,
    `</svg>`,
  ].join('');
  return { filterId, defs };
}
