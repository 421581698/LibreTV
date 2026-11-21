import { describe, expect, it } from 'vitest';
import { createInitialPlaybackSnapshot, reducePlayback } from './playback-state';

const source = { url: 'https://media.example/movie.m3u8', kind: 'hls' as const };

describe('native player playback state', () => {
  it('loads a source and advances through ready, playing and paused', () => {
    let state = createInitialPlaybackSnapshot(1);
    state = reducePlayback(state, { type: 'LOAD', source }, 2);
    expect(state.phase).toBe('loading');
    expect(state.source).toEqual(source);

    state = reducePlayback(state, { type: 'METADATA', duration: 120 }, 3);
    expect(state.phase).toBe('ready');
    expect(state.duration).toBe(120);

    state = reducePlayback(state, { type: 'PLAYING' }, 4);
    expect(state.phase).toBe('playing');

    state = reducePlayback(state, { type: 'PAUSE' }, 5);
    expect(state.phase).toBe('paused');
  });

  it('does not show buffering after a user pause', () => {
    let state = reducePlayback(createInitialPlaybackSnapshot(), { type: 'LOAD', source });
    state = reducePlayback(state, { type: 'PAUSE' });
    state = reducePlayback(state, { type: 'WAITING' });
    expect(state.phase).toBe('paused');
  });

  it('keeps time and buffer values non-negative', () => {
    let state = reducePlayback(createInitialPlaybackSnapshot(), { type: 'LOAD', source });
    state = reducePlayback(state, { type: 'TIME_UPDATE', currentTime: -4, bufferedAhead: -1 });
    expect(state.currentTime).toBe(0);
    expect(state.bufferedAhead).toBe(0);
  });

  it('does not accept backend events after disposal', () => {
    let state = reducePlayback(createInitialPlaybackSnapshot(), { type: 'DISPOSE' });
    state = reducePlayback(state, { type: 'PLAYING' });
    expect(state.phase).toBe('disposed');
  });

  it('resets cleanly for a new playback session', () => {
    let state = reducePlayback(createInitialPlaybackSnapshot(), { type: 'LOAD', source });
    state = reducePlayback(state, { type: 'DISPOSE' });
    state = reducePlayback(state, { type: 'RESET' });
    expect(state.phase).toBe('idle');
    expect(state.source).toBeNull();
  });
});
