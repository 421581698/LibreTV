import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeMediaBackend } from './native-media-backend';
import type { PlaybackBackend } from './backend-contract';
import { PlaybackController } from './playback-controller';

afterEach(() => {
  vi.unstubAllGlobals();
});

function createExistingVideo() {
  const target = new EventTarget() as EventTarget & Record<string, unknown>;
  const load = vi.fn();
  Object.assign(target, {
    src: 'https://media.example.test/already-playing.mp4',
    currentSrc: 'https://media.example.test/already-playing.mp4',
    currentTime: 12,
    duration: 42,
    readyState: 4,
    paused: false,
    ended: false,
    volume: 1,
    muted: false,
    playbackRate: 1,
    seeking: false,
    error: null,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    load,
  });
  return { video: target as unknown as HTMLMediaElement, load };
}

describe('NativeMediaBackend observation mode', () => {
  it('observes an existing source without assigning src or calling load', () => {
    vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3 });
    const { video, load } = createExistingVideo();
    const originalSrc = video.src;
    const backend = new NativeMediaBackend();
    const controller = new PlaybackController(backend);

    const result = controller.observeExistingSource(
      { url: originalSrc, kind: 'mp4' },
      video,
    );

    expect(result).toEqual({ ok: true });
    expect(video.src).toBe(originalSrc);
    expect(load).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe('playing');
    expect(controller.getSnapshot().duration).toBe(42);
    expect(controller.getSnapshot().currentTime).toBe(12);

    video.dispatchEvent(new Event('waiting'));
    expect(controller.getSnapshot().phase).toBe('buffering');

    controller.dispose();
  });

  it('detaches the previous media element when the observed source changes', () => {
    vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3 });
    const first = createExistingVideo();
    const second = createExistingVideo();
    const controller = new PlaybackController(new NativeMediaBackend());

    expect(controller.observeExistingSource(
      { url: String(first.video.src), kind: 'mp4' },
      first.video,
    )).toEqual({ ok: true });
    expect(controller.observeExistingSource(
      { url: String(second.video.src), kind: 'mp4' },
      second.video,
    )).toEqual({ ok: true });

    expect(controller.getSnapshot().phase).toBe('playing');
    first.video.dispatchEvent(new Event('waiting'));
    expect(controller.getSnapshot().phase).toBe('playing');
    second.video.dispatchEvent(new Event('waiting'));
    expect(controller.getSnapshot().phase).toBe('buffering');

    controller.dispose();
  });

  it('does not silently fall back to a source-owning load path', () => {
    const backend = {
      kind: 'experimental' as const,
      attach: vi.fn(),
      load: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      setVolume: vi.fn(),
      setMuted: vi.fn(),
      setPlaybackRate: vi.fn(),
      selectAudioTrack: vi.fn(),
      selectTextTrack: vi.fn(),
      selectQuality: vi.fn(),
      getCapabilities: vi.fn(),
      getSnapshot: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      dispose: vi.fn(),
    } as unknown as PlaybackBackend;
    const controller = new PlaybackController(backend);
    const result = controller.observeExistingSource(
      { url: 'https://media.example.test/a.mp4', kind: 'mp4' },
      createExistingVideo().video,
    );
    expect(result).toEqual({ ok: false, reason: 'unsupported' });
    expect(backend.load).not.toHaveBeenCalled();
    controller.dispose();
  });
});
