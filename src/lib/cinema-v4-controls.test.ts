import { describe, expect, it } from 'vitest';
import { nextCinemaPlaybackRate, shouldHoldCinemaControls, toggleCinemaPanel } from './cinema-v4-controls';

describe('Cinema V4 control policy', () => {
  it('cycles all accessible rates without changing the current media source', () => {
    expect([1, 1.25, 1.5, 2, 0.75].map(nextCinemaPlaybackRate)).toEqual([1.25, 1.5, 2, 0.75, 1]);
    expect(nextCinemaPlaybackRate(Number.NaN)).toBe(1);
  });
  it('toggles one modal panel at a time', () => {
    expect(toggleCinemaPanel(null, 'quality')).toBe('quality');
    expect(toggleCinemaPanel('quality', 'quality')).toBeNull();
    expect(toggleCinemaPanel('quality', 'diagnostics')).toBe('diagnostics');
    expect(toggleCinemaPanel('audio', 'subtitles')).toBe('subtitles');
    expect(toggleCinemaPanel('subtitles', 'audio')).toBe('audio');
  });
  it('never hides the transport while scrubbing, a sheet is open, or playback is paused', () => {
    expect(shouldHoldCinemaControls(true, false, false, false)).toBe(true);
    expect(shouldHoldCinemaControls(false, true, false, false)).toBe(true);
    expect(shouldHoldCinemaControls(false, false, true, false)).toBe(true);
    expect(shouldHoldCinemaControls(false, false, false, true)).toBe(true);
    expect(shouldHoldCinemaControls(false, false, false, false)).toBe(false);
  });
});
