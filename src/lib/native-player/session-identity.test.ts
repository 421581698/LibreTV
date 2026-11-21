import { describe, expect, it } from 'vitest';
import {
  createPlaybackEventCursor,
  createPlaybackSessionIdentity,
  isCurrentPlaybackEvent,
} from './session-identity';

describe('playback session identity', () => {
  it('creates immutable session identity', () => {
    const identity = createPlaybackSessionIdentity('session-a', 1);
    expect(identity).toEqual({ sessionId: 'session-a', generation: 1 });
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it('rejects empty session ids and invalid generations', () => {
    expect(() => createPlaybackSessionIdentity(' ', 1)).toThrow();
    expect(() => createPlaybackSessionIdentity('session-a', -1)).toThrow();
    expect(() => createPlaybackSessionIdentity('session-a', 1.5)).toThrow();
  });

  it('accepts only newer events from the active generation', () => {
    const identity = createPlaybackSessionIdentity('session-a', 3);
    const cursor = { ...createPlaybackEventCursor(identity), lastAcceptedSequence: 4 };

    expect(isCurrentPlaybackEvent(cursor, {
      identity,
      sequence: 5,
      event: 'PLAYING',
    })).toBe(true);

    expect(isCurrentPlaybackEvent(cursor, {
      identity,
      sequence: 4,
      event: 'WAITING',
    })).toBe(false);
    expect(isCurrentPlaybackEvent(cursor, {
      identity,
      sequence: 3,
      event: 'WAITING',
    })).toBe(false);
  });

  it('rejects events from an old session or source generation', () => {
    const active = createPlaybackSessionIdentity('session-a', 2);
    const cursor = createPlaybackEventCursor(active);

    expect(isCurrentPlaybackEvent(cursor, {
      identity: createPlaybackSessionIdentity('session-a', 1),
      sequence: 1,
      event: 'PLAYING',
    })).toBe(false);
    expect(isCurrentPlaybackEvent(cursor, {
      identity: createPlaybackSessionIdentity('session-b', 2),
      sequence: 1,
      event: 'PLAYING',
    })).toBe(false);
  });

  it('rejects invalid event sequence values', () => {
    const identity = createPlaybackSessionIdentity('session-a', 1);
    const cursor = createPlaybackEventCursor(identity);

    expect(isCurrentPlaybackEvent(cursor, {
      identity,
      sequence: 0,
      event: 'PLAYING',
    })).toBe(false);
    expect(isCurrentPlaybackEvent(cursor, {
      identity,
      sequence: Number.NaN,
      event: 'PLAYING',
    })).toBe(false);
  });
});
