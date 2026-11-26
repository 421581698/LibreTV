import { describe, expect, it } from 'vitest';
import { captureNativeAudioFallback, fallbackResumeTime } from './native-audio-fallback';

describe('native Safari Dolby audio failure → hls.js handoff', () => {
  it('preserves timeline and speed for a playing media element', () => {
    const snapshot = captureNativeAudioFallback(
      { currentTime: 115.5, playbackRate: 1.25, paused: false }, true,
    );
    expect(snapshot).toEqual({ currentTime: 115.5, playbackRate: 1.25, shouldPlay: true });
    expect(fallbackResumeTime(snapshot, 500)).toBe(115.5);
  });

  it('preserves an intentional pause once playback has started', () => {
    expect(captureNativeAudioFallback(
      { currentTime: 33, playbackRate: 1, paused: true }, true,
    ).shouldPlay).toBe(false);
  });

  it('permits initial autoplay after a native decoder failure before playback', () => {
    expect(captureNativeAudioFallback(
      { currentTime: 0, playbackRate: 1, paused: true }, false,
    ).shouldPlay).toBe(true);
  });

  it('rejects invalid times, speeds and positions outside the replacement duration', () => {
    const snapshot = captureNativeAudioFallback(
      { currentTime: Number.NaN, playbackRate: Number.POSITIVE_INFINITY, paused: true }, false,
    );
    expect(snapshot.currentTime).toBe(0);
    expect(snapshot.playbackRate).toBe(1);
    expect(fallbackResumeTime({ ...snapshot, currentTime: 120 }, 120)).toBe(0);
    expect(fallbackResumeTime({ ...snapshot, currentTime: 20 }, Number.NaN)).toBe(0);
    expect(fallbackResumeTime({ ...snapshot, currentTime: 20 }, 100)).toBe(20);
  });
});
