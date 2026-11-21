import type { PlaybackEvent, PlaybackSnapshot } from './types';

export function createInitialPlaybackSnapshot(now = Date.now()): PlaybackSnapshot {
  return {
    phase: 'idle',
    source: null,
    currentTime: 0,
    duration: 0,
    bufferedAhead: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    seeking: false,
    error: null,
    updatedAt: now,
  };
}

/**
 * Pure playback lifecycle reducer. Backend events are normalized before they
 * reach this function; UI components never mutate phase directly.
 */
export function reducePlayback(
  state: PlaybackSnapshot,
  event: PlaybackEvent,
  now = Date.now(),
): PlaybackSnapshot {
  if (state.phase === 'disposed' && event.type !== 'RESET') return state;

  const next = { ...state, updatedAt: now };

  switch (event.type) {
    case 'LOAD':
      return {
        ...createInitialPlaybackSnapshot(now),
        phase: 'loading',
        source: event.source,
      };
    case 'METADATA':
      return {
        ...next,
        duration: Number.isFinite(event.duration) && event.duration > 0 ? event.duration : 0,
        phase: state.phase === 'loading' ? 'ready' : state.phase,
      };
    case 'CAN_PLAY':
      return { ...next, phase: state.phase === 'playing' ? 'playing' : 'ready', error: null };
    case 'PLAY_REQUEST':
      if (!state.source || state.phase === 'error' || state.phase === 'ended') return next;
      return { ...next, phase: 'loading' };
    case 'PLAYING':
      if (!state.source) return next;
      return { ...next, phase: 'playing', error: null };
    case 'PAUSE':
      if (state.phase === 'idle' || state.phase === 'disposed' || state.phase === 'ended') return next;
      return { ...next, phase: 'paused' };
    case 'WAITING':
      if (!state.source || state.phase === 'paused' || state.phase === 'ended') return next;
      return { ...next, phase: 'buffering' };
    case 'TIME_UPDATE':
      return {
        ...next,
        currentTime: Number.isFinite(event.currentTime) ? Math.max(0, event.currentTime) : state.currentTime,
        bufferedAhead: event.bufferedAhead !== undefined && Number.isFinite(event.bufferedAhead)
          ? Math.max(0, event.bufferedAhead)
          : state.bufferedAhead,
      };
    case 'SEEK_START':
      return { ...next, seeking: true };
    case 'SEEKED':
      return { ...next, seeking: false };
    case 'ENDED':
      return { ...next, phase: 'ended', seeking: false };
    case 'ERROR':
      return { ...next, phase: 'error', error: event.error, seeking: false };
    case 'RESET':
      return createInitialPlaybackSnapshot(now);
    case 'DISPOSE':
      return { ...next, phase: 'disposed', seeking: false };
    default:
      return next;
  }
}
