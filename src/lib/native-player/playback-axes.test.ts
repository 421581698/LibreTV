import { describe, expect, it } from 'vitest';
import { initialPlaybackAxes, reducePlaybackAxes } from './playback-axes';

describe('multi-axis playback state', () => {
  it('tracks network and decode independently from playback phase', () => {
    let state = reducePlaybackAxes(initialPlaybackAxes, { type: 'LOAD' });
    state = reducePlaybackAxes(state, { type: 'READY' });
    state = reducePlaybackAxes(state, { type: 'PLAY' });
    state = reducePlaybackAxes(state, { type: 'NETWORK', value: 'stalled' });
    state = reducePlaybackAxes(state, { type: 'DECODE', value: 'waiting' });
    expect(state.playback).toBe('playing');
    expect(state.network).toBe('stalled');
    expect(state.decode).toBe('waiting');
  });

  it('resets transient resources on dispose', () => {
    const state = reducePlaybackAxes({ ...initialPlaybackAxes, playback: 'playing', audio: 'processing', fullscreen: 'fullscreen' }, { type: 'DISPOSE' });
    expect(state.playback).toBe('disposed');
    expect(state.audio).toBe('native');
    expect(state.fullscreen).toBe('inline');
  });
});
