import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindWatchPlaybackState, toggleWatchPlayback } from './watch-playback-state';

type TestVideo = HTMLVideoElement & {
  setPaused: (value: boolean) => void;
};

function makeVideo(initiallyPaused = true) {
  const target = new EventTarget() as TestVideo;
  let paused = initiallyPaused;
  Object.defineProperties(target, {
    paused: { configurable: true, get: () => paused },
    ended: { configurable: true, get: () => false },
    playbackRate: { configurable: true, get: () => 1.25 },
  });
  target.setPaused = (value: boolean) => { paused = value; };
  target.play = vi.fn(async () => {
    paused = false;
    target.dispatchEvent(new Event('play'));
    target.dispatchEvent(new Event('playing'));
  });
  target.pause = vi.fn(() => {
    paused = true;
    target.dispatchEvent(new Event('pause'));
  });
  return target;
}

class TestMutationObserver {
  static instances: TestMutationObserver[] = [];
  private disconnected = false;
  constructor(private readonly callback: MutationCallback) {
    TestMutationObserver.instances.push(this);
  }
  observe() {}
  disconnect() { this.disconnected = true; }
  takeRecords(): MutationRecord[] { return []; }
  get isDisconnected() { return this.disconnected; }
  trigger() {
    if (!this.disconnected) this.callback([], this as unknown as MutationObserver);
  }
}

afterEach(() => {
  TestMutationObserver.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bindWatchPlaybackState', () => {
  it('tracks native playback events and the playback rate', () => {
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    const video = makeVideo();
    const frame = { querySelector: () => video } as unknown as HTMLElement;
    const onChange = vi.fn();
    const cleanup = bindWatchPlaybackState(frame, onChange);

    expect(onChange).toHaveBeenLastCalledWith({ isPlaying: false, playbackRate: 1.25 });
    video.setPaused(false);
    video.dispatchEvent(new Event('playing'));
    expect(onChange).toHaveBeenLastCalledWith({ isPlaying: true, playbackRate: 1.25 });

    video.setPaused(true);
    video.dispatchEvent(new Event('pause'));
    expect(onChange).toHaveBeenLastCalledWith({ isPlaying: false, playbackRate: 1.25 });
    cleanup();
  });

  it('detaches the old video and binds its replacement', () => {
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    const first = makeVideo();
    const second = makeVideo();
    let active: HTMLVideoElement = first;
    const frame = { querySelector: () => active } as unknown as HTMLElement;
    const onChange = vi.fn();
    const cleanup = bindWatchPlaybackState(frame, onChange);
    const observer = TestMutationObserver.instances[0];

    first.setPaused(false);
    first.dispatchEvent(new Event('playing'));
    expect(onChange).toHaveBeenLastCalledWith({ isPlaying: true, playbackRate: 1.25 });

    active = second;
    observer.trigger();
    expect(onChange).toHaveBeenLastCalledWith({ isPlaying: false, playbackRate: null });

    first.setPaused(true);
    first.dispatchEvent(new Event('pause'));
    expect(onChange).toHaveBeenLastCalledWith({ isPlaying: false, playbackRate: 1.25 });

    second.setPaused(false);
    second.dispatchEvent(new Event('playing'));
    expect(onChange).toHaveBeenLastCalledWith({ isPlaying: true, playbackRate: 1.25 });
    cleanup();
    second.setPaused(true);
    second.dispatchEvent(new Event('pause'));
    expect(observer.isDisconnected).toBe(true);
  });
});

describe('toggleWatchPlayback', () => {
  it('supports play, pause, and replay transitions', async () => {
    const video = makeVideo();
    const states: boolean[] = [];
    const current = () => true;

    toggleWatchPlayback(video, current, state => states.push(state));
    await Promise.resolve();
    expect(states).toEqual([true]);

    toggleWatchPlayback(video, current, state => states.push(state));
    expect(states).toEqual([true, false]);
    expect(video.paused).toBe(true);

    toggleWatchPlayback(video, current, state => states.push(state));
    await Promise.resolve();
    expect(states).toEqual([true, false, true]);
    expect(video.paused).toBe(false);
  });

  it('keeps the UI paused when play() rejects', async () => {
    const video = makeVideo();
    video.play = vi.fn(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
    const onChange = vi.fn();

    toggleWatchPlayback(video, () => true, onChange);
    await Promise.resolve();
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('ignores a stale play promise after the video is replaced', async () => {
    const video = makeVideo();
    let resolvePlay: (() => void) | undefined;
    video.play = vi.fn(() => new Promise<void>(resolve => { resolvePlay = resolve; }));
    const onChange = vi.fn();
    let current = true;

    toggleWatchPlayback(video, () => current, onChange);
    current = false;
    video.setPaused(false);
    resolvePlay?.();
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();
  });
});
