import { describe, expect, it } from 'vitest';
import { hasSustainedPlaybackProgress } from './playback-verification';

describe('hasSustainedPlaybackProgress', () => {
  it('confirms a ready, unpaused video after measurable progress', () => {
    expect(hasSustainedPlaybackProgress({
      paused: false, readyState: 3, startTime: 10, currentTime: 13,
    })).toBe(true);
  });

  it('does not accept a play event without timeline progress', () => {
    expect(hasSustainedPlaybackProgress({
      paused: false, readyState: 3, startTime: 10, currentTime: 10,
    })).toBe(false);
  });

  it('rejects a paused or not-yet-decoded element', () => {
    expect(hasSustainedPlaybackProgress({
      paused: true, readyState: 3, startTime: 10, currentTime: 13,
    })).toBe(false);
    expect(hasSustainedPlaybackProgress({
      paused: false, readyState: 1, startTime: 10, currentTime: 13,
    })).toBe(false);
  });

  it('rejects non-finite and backward timestamps', () => {
    expect(hasSustainedPlaybackProgress({
      paused: false, readyState: 3, startTime: 10, currentTime: Number.NaN,
    })).toBe(false);
    expect(hasSustainedPlaybackProgress({
      paused: false, readyState: 3, startTime: 10, currentTime: 9,
    })).toBe(false);
  });
});
