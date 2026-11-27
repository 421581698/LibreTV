import type { CinemaActivation } from './container';

export type DetailCapsulePolicy = 'baseline-visible' | 'hidden';
export type NavChrome = {
  sidebar: 'visible' | 'hidden';
  capsule: 'visible' | 'hidden';
  back: 'hidden' | 'independent' | 'player-close';
};

export const PLAYER_FULLSCREEN_CHROME: NavChrome = {
  sidebar: 'hidden',
  capsule: 'hidden',
  back: 'player-close',
};

export function chromeForPage(
  page: 'home' | 'detail',
  activation: Exclude<CinemaActivation, 'inactive'>,
  detailCapsule: DetailCapsulePolicy,
): NavChrome {
  if (page === 'home') {
    return {
      sidebar: activation === 'stage' ? 'visible' : 'hidden',
      capsule: 'visible',
      back: 'hidden',
    };
  }
  return {
    sidebar: 'hidden',
    capsule: detailCapsule === 'baseline-visible' ? 'visible' : 'hidden',
    back: 'independent',
  };
}
