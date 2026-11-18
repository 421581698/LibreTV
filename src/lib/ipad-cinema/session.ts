import type { CinemaActivation } from './container';
import type { DetailCapsulePolicy } from './chrome';
import { resolvedFocusAxis, type FocusAxis } from './focus-engine';

export type HistoryAction = 'none' | 'back-once';
export type VoiceOverSessionState = 'unknown' | 'running' | 'stopped';

export type PageSurface =
  | { readonly type: 'home' }
  | { readonly type: 'detail'; readonly key: string };

export type PlayerOverlay = {
  readonly presentation: 'fullscreen' | 'floating';
  readonly routeOwned: boolean;
};

export type FocusSlice = {
  readonly regionId: string | null;
  readonly index: number;
  readonly scrollOffset: number;
  readonly preferredAxis: FocusAxis;
};

export type PageSnapshot = {
  readonly page: PageSurface;
  readonly focus: FocusSlice;
};

export type ExperienceSession = {
  readonly activation: CinemaActivation;
  readonly voiceOver: VoiceOverSessionState;
  readonly detailCapsule: DetailCapsulePolicy;
  readonly page: PageSurface;
  readonly player: PlayerOverlay | null;
  readonly focus: FocusSlice;
  readonly stack: readonly PageSnapshot[];
};

export type SessionResult = {
  readonly session: ExperienceSession;
  readonly historyAction: HistoryAction;
};

export const INITIAL_FOCUS: FocusSlice = {
  regionId: null,
  index: 0,
  scrollOffset: 0,
  preferredAxis: 'horizontal',
};

const noop = (session: ExperienceSession): SessionResult => ({ session, historyAction: 'none' });

export function createSession(partial?: {
  activation?: CinemaActivation;
  detailCapsule?: DetailCapsulePolicy;
}): ExperienceSession {
  return {
    activation: partial?.activation ?? 'inactive',
    voiceOver: 'unknown',
    detailCapsule: partial?.detailCapsule ?? 'baseline-visible',
    page: { type: 'home' },
    player: null,
    focus: INITIAL_FOCUS,
    stack: [],
  };
}

export function playerExitHistory(
  presentation: PlayerOverlay['presentation'],
  routeOwned: boolean,
): HistoryAction {
  if (presentation !== 'fullscreen' || !routeOwned) return 'none';
  return 'back-once';
}

export function setVoiceOverState(session: ExperienceSession, voiceOver: VoiceOverSessionState): SessionResult {
  if (session.voiceOver === voiceOver) return noop(session);
  return { session: { ...session, voiceOver }, historyAction: 'none' };
}

export function setActivation(session: ExperienceSession, activation: CinemaActivation): SessionResult {
  if (session.activation === activation) return noop(session);
  return { session: { ...session, activation }, historyAction: 'none' };
}

export function setDetailCapsule(
  session: ExperienceSession,
  detailCapsule: DetailCapsulePolicy,
): SessionResult {
  if (session.detailCapsule === detailCapsule) return noop(session);
  return { session: { ...session, detailCapsule }, historyAction: 'none' };
}

/** Focus writes its own slice. Navigation stack, page and player stay untouched. */
export function updateFocus(session: ExperienceSession, focus: FocusSlice): SessionResult {
  const current = session.focus;
  if (
    current.regionId === focus.regionId &&
    current.index === focus.index &&
    current.scrollOffset === focus.scrollOffset &&
    current.preferredAxis === focus.preferredAxis
  ) {
    return noop(session);
  }
  return { session: { ...session, focus }, historyAction: 'none' };
}

export function enterDetail(session: ExperienceSession, key: string): SessionResult {
  if (session.player?.presentation === 'fullscreen') return noop(session);
  if (session.page.type === 'detail' && session.page.key === key) return noop(session);
  return {
    session: {
      ...session,
      page: { type: 'detail', key },
      focus: INITIAL_FOCUS,
      stack: [...session.stack, { page: session.page, focus: session.focus }],
    },
    historyAction: 'none',
  };
}

/**
 * Fullscreen back closes the player presentation.
 * A floating player inherits the page underneath, so back moves that page and keeps the player.
 * Leaving a route-owned fullscreen player asks for exactly one history back, never a second pop.
 */
export function goBack(session: ExperienceSession): SessionResult {
  if (session.player?.presentation === 'fullscreen') return exitPlayer(session);
  if (session.stack.length === 0) {
    return {
      session,
      historyAction: session.page.type === 'detail' ? 'back-once' : 'none',
    };
  }
  const previous = session.stack[session.stack.length - 1];
  return {
    session: {
      ...session,
      page: previous.page,
      focus: previous.focus,
      stack: session.stack.slice(0, -1),
    },
    historyAction: 'back-once',
  };
}

export function enterPlayer(session: ExperienceSession, player: PlayerOverlay): SessionResult {
  const current = session.player;
  if (
    current &&
    current.presentation === player.presentation &&
    current.routeOwned === player.routeOwned
  ) {
    return noop(session);
  }
  return { session: { ...session, player }, historyAction: 'none' };
}

export function exitPlayer(session: ExperienceSession): SessionResult {
  if (!session.player) return noop(session);
  return {
    session: { ...session, player: null },
    historyAction: playerExitHistory(session.player.presentation, session.player.routeOwned),
  };
}

/** Abnormal player teardown restores navigation without consuming history. */
export function recover(session: ExperienceSession): SessionResult {
  if (!session.player) return noop(session);
  return { session: { ...session, player: null }, historyAction: 'none' };
}

export function resetToHome(session: ExperienceSession): SessionResult {
  if (session.player?.presentation === 'fullscreen') return noop(session);
  if (session.page.type === 'home' && session.stack.length === 0 && session.focus === INITIAL_FOCUS) {
    return noop(session);
  }
  return {
    session: {
      ...session,
      page: { type: 'home' },
      focus: INITIAL_FOCUS,
      stack: [],
    },
    historyAction: 'none',
  };
}

export function resolvedSessionAxis(session: ExperienceSession): FocusAxis {
  return resolvedFocusAxis(session.activation, session.focus.preferredAxis);
}
