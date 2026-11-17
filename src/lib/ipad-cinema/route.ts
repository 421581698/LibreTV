import type { NavChrome } from './chrome';
import { chromeForPage, PLAYER_FULLSCREEN_CHROME } from './chrome';
import { resolvedFocusAxis } from './focus-engine';
import {
  enterPlayer,
  recover,
  type ExperienceSession,
  type SessionResult,
} from './session';

export type RouteSnapshot =
  | { readonly kind: 'home' }
  | { readonly kind: 'detail'; readonly key: string }
  | { readonly kind: 'watch' }
  | { readonly kind: 'other'; readonly path: string };

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const path = pathname.split('?')[0].split('#')[0];
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function parseRoute(pathname: string, search = ''): RouteSnapshot {
  const path = normalizePathname(pathname);
  if (path === '/') return { kind: 'home' };
  if (path === '/detail') {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const key = `${params.get('source') || ''}::${params.get('id') || params.get('url') || ''}`;
    return { kind: 'detail', key };
  }
  if (path === '/watch') return { kind: 'watch' };
  return { kind: 'other', path };
}

/**
 * Route observation only opens or clears a route-owned fullscreen player.
 * It never pops page history: leaving `/watch` means the browser already moved.
 * Detail forward/back stays on the explicit session API, because a key change is ambiguous.
 */
export function reconcilePlayerRoute(session: ExperienceSession, route: RouteSnapshot): SessionResult {
  if (route.kind === 'watch') {
    return enterPlayer(session, { presentation: 'fullscreen', routeOwned: true });
  }
  if (session.player?.presentation === 'fullscreen' && session.player.routeOwned) {
    return recover(session);
  }
  return { session, historyAction: 'none' };
}

export function projectLiveChrome(
  session: ExperienceSession,
  route: RouteSnapshot,
): NavChrome | null {
  if (session.activation === 'inactive' || route.kind === 'other') return null;
  if (session.player?.presentation === 'fullscreen' || route.kind === 'watch') {
    return PLAYER_FULLSCREEN_CHROME;
  }
  if (route.kind === 'home') return chromeForPage('home', session.activation, session.detailCapsule);
  if (route.kind === 'detail') return chromeForPage('detail', session.activation, session.detailCapsule);
  return null;
}

export const IPAD_CINEMA_ATTRIBUTES = [
  'data-ipad-cinema',
  'data-nav-owner',
  'data-nav-sidebar',
  'data-nav-capsule',
  'data-nav-back',
  'data-focus-axis',
  'data-player-presentation',
] as const;

export type IpadCinemaAttribute = (typeof IPAD_CINEMA_ATTRIBUTES)[number];

export type AttributeProjection = Record<IpadCinemaAttribute, string | null>;

const CLEARED_ATTRIBUTES: AttributeProjection = {
  'data-ipad-cinema': null,
  'data-nav-owner': null,
  'data-nav-sidebar': null,
  'data-nav-capsule': null,
  'data-nav-back': null,
  'data-focus-axis': null,
  'data-player-presentation': null,
};

export function projectAttributes(session: ExperienceSession, route: RouteSnapshot): AttributeProjection {
  const chrome = projectLiveChrome(session, route);
  if (!chrome || (session.activation !== 'compact' && session.activation !== 'stage')) {
    return CLEARED_ATTRIBUTES;
  }
  const presentation = session.player?.presentation ?? (route.kind === 'watch' ? 'fullscreen' : 'none');
  return {
    'data-ipad-cinema': session.activation,
    'data-nav-owner': 'adaptive',
    'data-nav-sidebar': chrome.sidebar,
    'data-nav-capsule': chrome.capsule,
    'data-nav-back': chrome.back,
    'data-focus-axis': resolvedFocusAxis(session.activation, session.focus.preferredAxis),
    'data-player-presentation': presentation,
  };
}

export function applyAttributes(
  element: {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  },
  attributes: AttributeProjection,
): void {
  for (const name of IPAD_CINEMA_ATTRIBUTES) {
    const value = attributes[name];
    if (value == null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
}
