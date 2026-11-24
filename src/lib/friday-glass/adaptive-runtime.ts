/**
 * Friday Liquid Glass Engine — Layer 4: Adaptive Runtime
 *
 * Detects device capability once (client only), classifies into a performance
 * tier, and exposes a reducer that downgrades optical work on weak devices,
 * reduced-motion users, low-power mode and off-screen surfaces.
 *
 * Pure module with no React dependency so it is trivially unit-testable.
 */

export type QualityTier = 'full' | 'balanced' | 'minimal' | 'off';

export interface RuntimeProfile {
  tier: QualityTier;
  reducedMotion: boolean;
  saveData: boolean;
  lowPower: boolean;
  /** Target frames per second for the optical layer. */
  fps: number;
  /** Device pixel ratio cap for the canvas backing store. */
  dprCap: number;
  /** Whether SVG refraction augmentation is allowed. */
  allowSvg: boolean;
  /** Whether the Canvas optical layer is allowed at all. */
  allowCanvas: boolean;
}

const TIER_FPS: Record<QualityTier, number> = {
  full: 60,
  balanced: 30,
  minimal: 15,
  off: 0,
};

const TIER_DPR: Record<QualityTier, number> = {
  full: 2,
  balanced: 1.5,
  minimal: 1,
  off: 1,
};

/** Read a navigator field safely across SSR and older browsers. */
function navNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Build a runtime profile from the current environment.
 * Safe to call on the server (returns minimal tier) and in any browser.
 */
export function detectProfile(env?: {
  navigator?: Navigator;
  matchMedia?: (q: string) => { matches: boolean };
  devicePixelRatio?: number;
}): RuntimeProfile {
  if (typeof window === 'undefined' && !env) {
    return baseProfile('minimal', { reducedMotion: false, saveData: false, lowPower: false });
  }

  const nav = env?.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const mm = env?.matchMedia
    ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : undefined);
  const dpr = env?.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);

  const reducedMotion = !!mm?.('(prefers-reduced-motion: reduce)')?.matches;
  const saveData = !!(nav as unknown as { connection?: { saveData?: boolean } })?.connection?.saveData;
  const cores = navNumber((nav as unknown as { hardwareConcurrency?: number })?.hardwareConcurrency);
  const memory = navNumber((nav as unknown as { deviceMemory?: number })?.deviceMemory);
  const lowPower = reducedMotion || saveData;
  const coarse = !!nav && nav.maxTouchPoints > 0;

  let tier: QualityTier = 'balanced';
  if (cores !== undefined && cores >= 8 && (memory === undefined || memory >= 8)) tier = 'full';
  if ((cores !== undefined && cores <= 4) || (memory !== undefined && memory <= 4)) tier = 'minimal';
  // Mobile GPUs: cap one notch to protect battery and scroll smoothness.
  if (coarse && tier === 'full') tier = 'balanced';

  if (reducedMotion) tier = 'minimal';
  if (saveData) tier = 'off';

  return baseProfile(tier, { reducedMotion, saveData, lowPower, dpr });
}

function baseProfile(
  tier: QualityTier,
  flags: { reducedMotion: boolean; saveData: boolean; lowPower: boolean; dpr?: number },
): RuntimeProfile {
  const allowCanvas = tier !== 'off';
  return {
    tier,
    reducedMotion: flags.reducedMotion,
    saveData: flags.saveData,
    lowPower: flags.lowPower,
    fps: TIER_FPS[tier],
    dprCap: Math.min(TIER_DPR[tier], flags.dpr ?? TIER_DPR[tier]),
    allowSvg: tier === 'full' && !flags.lowPower,
    allowCanvas,
  };
}

/**
 * Apply visibility / intersection downgrade: an off-screen surface drops to
 * minimal work, a visible full-tier surface stays at its detected tier.
 */
export function withVisibility(profile: RuntimeProfile, visible: boolean): RuntimeProfile {
  if (visible || profile.tier === 'off') return profile;
  return { ...profile, fps: TIER_FPS.minimal, allowSvg: false };
}

export const RUNTIME_DEFAULTS: RuntimeProfile = detectProfile();
