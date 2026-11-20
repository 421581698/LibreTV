export const CINEMA_COMPACT_MIN = 700;
export const CINEMA_STAGE_MIN = 1024;

export type CinemaActivation = 'inactive' | 'compact' | 'stage';

export function resolveCinemaActivation(isIpad: boolean, width: number): CinemaActivation {
  if (!isIpad || !Number.isFinite(width) || width < CINEMA_COMPACT_MIN) return 'inactive';
  if (width < CINEMA_STAGE_MIN) return 'compact';
  return 'stage';
}
