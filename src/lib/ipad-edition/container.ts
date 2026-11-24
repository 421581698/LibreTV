export const CINEMA_COMPACT_MIN = 700;
export const CINEMA_STAGE_MIN = 1024;

export type CinemaActivation = 'inactive' | 'compact' | 'stage';

export function resolveCinemaActivation(isIpad: boolean, width: number): CinemaActivation {
  if (!isIpad || !Number.isFinite(width) || width < CINEMA_COMPACT_MIN) return 'inactive';
  if (width < CINEMA_STAGE_MIN) return 'compact';
  return 'stage';
}

export type IpadNavigationLayout = 'compact' | 'expanded';

/** Navigation follows the actual application window width, not device or orientation. */
export function resolveIpadNavigationLayout(width: number): IpadNavigationLayout {
  return Number.isFinite(width) && width >= 1024 ? 'expanded' : 'compact';
}
