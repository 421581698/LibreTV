import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestNativeFullscreenWithFallback, type NativeFullscreenVideo } from './player-fullscreen';

function mockVideo(enter?: () => void) {
  const target = new EventTarget() as EventTarget & Partial<NativeFullscreenVideo>;
  target.webkitEnterFullscreen = enter;
  target.webkitDisplayingFullscreen = false;
  return target as NativeFullscreenVideo;
}

describe('requestNativeFullscreenWithFallback', () => {
  afterEach(() => vi.useRealTimers());

  it('falls back when WebKit accepts the call but never enters native fullscreen', () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    const dispose = requestNativeFullscreenWithFallback(mockVideo(vi.fn()), fallback, 800);
    vi.advanceTimersByTime(799);
    expect(fallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('does not fall back after webkitbeginfullscreen', () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    const video = mockVideo(vi.fn());
    requestNativeFullscreenWithFallback(video, fallback, 800);
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
    vi.advanceTimersByTime(1000);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back immediately when the native method is missing or throws', () => {
    const fallbackMissing = vi.fn();
    requestNativeFullscreenWithFallback(mockVideo(), fallbackMissing);
    expect(fallbackMissing).toHaveBeenCalledTimes(1);

    const fallbackThrow = vi.fn();
    requestNativeFullscreenWithFallback(mockVideo(() => { throw new Error('denied'); }), fallbackThrow);
    expect(fallbackThrow).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the fallback after the caller disposes the pending request', () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    const dispose = requestNativeFullscreenWithFallback(mockVideo(vi.fn()), fallback, 800);

    dispose();
    vi.advanceTimersByTime(1000);

    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not invoke the fallback if WebKit is already displaying native fullscreen at timeout', () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    const video = mockVideo(vi.fn());
    requestNativeFullscreenWithFallback(video, fallback, 800);

    video.webkitDisplayingFullscreen = true;
    vi.advanceTimersByTime(800);

    expect(fallback).not.toHaveBeenCalled();
  });

  it('invokes the fallback at most once when timeout and a late WebKit event race', () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    const video = mockVideo(vi.fn());
    requestNativeFullscreenWithFallback(video, fallback, 800);

    vi.advanceTimersByTime(800);
    video.dispatchEvent(new Event('webkitbeginfullscreen'));

    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
