import { describe, expect, it, vi } from 'vitest';
import type { BackendCommandResult } from './backend-contract';
import { installArtPlayerControlBridge } from './artplayer-control-bridge';

function createVideo() {
  let currentTime = 4;
  const video = {
    play: vi.fn(async () => undefined),
    pause: vi.fn(() => undefined),
  } as unknown as HTMLVideoElement;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    enumerable: true,
    get: () => currentTime,
    set: (value: number) => { currentTime = value; },
  });
  return { video, readTime: () => currentTime };
}

describe('installArtPlayerControlBridge', () => {
  it('routes existing media play/pause/seek calls through the controller without recursion', async () => {
    const { video, readTime } = createVideo();
    const nativePlay = video.play;
    const nativePause = video.pause;
    const controller = {
      play: vi.fn(async (): Promise<BackendCommandResult> => {
        await video.play();
        return { ok: true };
      }),
      pause: vi.fn((): BackendCommandResult => {
        video.pause();
        return { ok: true };
      }),
      seek: vi.fn((seconds: number): BackendCommandResult => {
        video.currentTime = seconds;
        return { ok: true };
      }),
    };
    const cleanup = installArtPlayerControlBridge(video, () => controller);

    await video.play();
    video.pause();
    video.currentTime = 31;

    expect(controller.play).toHaveBeenCalledOnce();
    expect(controller.pause).toHaveBeenCalledOnce();
    expect(controller.seek).toHaveBeenCalledWith(31);
    expect(nativePlay).toHaveBeenCalledOnce();
    expect(nativePause).toHaveBeenCalledOnce();
    expect(readTime()).toBe(31);
    cleanup();
  });

  it('uses native media methods when no controller is attached', async () => {
    const { video } = createVideo();
    const nativePlay = video.play;
    const nativePause = video.pause;
    const cleanup = installArtPlayerControlBridge(video, () => null);
    await video.play();
    video.pause();
    video.currentTime = 17;
    expect(nativePlay).toHaveBeenCalledOnce();
    expect(nativePause).toHaveBeenCalledOnce();
    cleanup();
  });

  it('falls back to native media methods when controller commands are unsupported', async () => {
    const { video } = createVideo();
    const nativePlay = video.play;
    const nativePause = video.pause;
    const controller = {
      play: vi.fn(async (): Promise<BackendCommandResult> => ({ ok: false, reason: 'unsupported' })),
      pause: vi.fn((): BackendCommandResult => ({ ok: false, reason: 'unsupported' })),
      seek: vi.fn((): BackendCommandResult => ({ ok: false, reason: 'unsupported' })),
    };
    const cleanup = installArtPlayerControlBridge(video, () => controller);
    await video.play();
    video.pause();
    video.currentTime = 22;
    expect(nativePlay).toHaveBeenCalledOnce();
    expect(nativePause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(22);
    cleanup();
  });

  it('does not retry native play after the controller reports a real media failure', async () => {
    const { video } = createVideo();
    const nativePlay = video.play;
    const controller = {
      play: vi.fn(async (): Promise<BackendCommandResult> => ({
        ok: false,
        reason: 'failed',
        error: { code: 'NETWORK', message: 'controller media failure', recoverable: false },
      })),
      pause: vi.fn((): BackendCommandResult => ({ ok: true })),
      seek: vi.fn((): BackendCommandResult => ({ ok: true })),
    };
    const cleanup = installArtPlayerControlBridge(video, () => controller);
    await expect(video.play()).rejects.toThrow('controller media failure');
    expect(nativePlay).not.toHaveBeenCalled();
    cleanup();
  });

  it('restores the exact original media-element descriptors on cleanup', async () => {
    const { video, readTime } = createVideo();
    const originalPlay = video.play;
    const originalPause = video.pause;
    const originalTime = Object.getOwnPropertyDescriptor(video, 'currentTime');
    const controller = {
      play: vi.fn(async (): Promise<BackendCommandResult> => ({ ok: true })),
      pause: vi.fn((): BackendCommandResult => ({ ok: true })),
      seek: vi.fn((): BackendCommandResult => ({ ok: true })),
    };
    const cleanup = installArtPlayerControlBridge(video, () => controller);
    cleanup();
    expect(video.play).toBe(originalPlay);
    expect(video.pause).toBe(originalPause);
    expect(Object.getOwnPropertyDescriptor(video, 'currentTime')).toEqual(originalTime);
    video.currentTime = 17;
    expect(readTime()).toBe(17);
  });
});
