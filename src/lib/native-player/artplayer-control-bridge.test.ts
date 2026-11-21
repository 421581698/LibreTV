import { describe, expect, it, vi } from 'vitest';
import type { BackendCommandResult } from './backend-contract';
import { installArtPlayerControlBridge } from './artplayer-control-bridge';

function createPlayer() {
  let currentTime = 4;
  const player = {
    play: vi.fn(async () => 'art-play'),
    pause: vi.fn(() => 'art-pause'),
  } as unknown as {
    play: () => unknown;
    pause: () => unknown;
    currentTime: number;
  };
  Object.defineProperty(player, 'currentTime', {
    configurable: true,
    enumerable: true,
    get: () => currentTime,
    set: (value: number) => { currentTime = value; },
  });
  return { player, readTime: () => currentTime };
}

describe('installArtPlayerControlBridge', () => {
  it('routes play, pause and seek through the active Cinema controller', async () => {
    const { player, readTime } = createPlayer();
    const controller = {
      play: vi.fn(async (): Promise<BackendCommandResult> => ({ ok: true })),
      pause: vi.fn((): BackendCommandResult => ({ ok: true })),
      seek: vi.fn((seconds: number): BackendCommandResult => {
        readTime();
        return { ok: true };
      }),
    };
    const cleanup = installArtPlayerControlBridge(player, () => controller);

    await player.play();
    player.pause();
    player.currentTime = 31;

    expect(controller.play).toHaveBeenCalledOnce();
    expect(controller.pause).toHaveBeenCalledOnce();
    expect(controller.seek).toHaveBeenCalledWith(31);
    expect(readTime()).toBe(4);
    expect(cleanup).toBeTypeOf('function');
    cleanup();
  });

  it('falls back to the original ArtPlayer methods when no controller is attached', async () => {
    const { player } = createPlayer();
    const cleanup = installArtPlayerControlBridge(player, () => null);
    await player.play();
    player.pause();
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.pause).toHaveBeenCalledOnce();
    cleanup();
  });

  it('falls back when the controller reports unsupported commands', async () => {
    const { player } = createPlayer();
    const controller = {
      play: vi.fn(async (): Promise<BackendCommandResult> => ({ ok: false, reason: 'unsupported' })),
      pause: vi.fn((): BackendCommandResult => ({ ok: false, reason: 'unsupported' })),
      seek: vi.fn((): BackendCommandResult => ({ ok: false, reason: 'unsupported' })),
    };
    const cleanup = installArtPlayerControlBridge(player, () => controller);
    await player.play();
    player.pause();
    player.currentTime = 22;
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.pause).toHaveBeenCalledOnce();
    cleanup();
  });

  it('restores the original ArtPlayer surface on cleanup', async () => {
    const { player, readTime } = createPlayer();
    const originalPlay = player.play;
    const originalPause = player.pause;
    const controller = {
      play: vi.fn(async (): Promise<BackendCommandResult> => ({ ok: true })),
      pause: vi.fn((): BackendCommandResult => ({ ok: true })),
      seek: vi.fn((): BackendCommandResult => ({ ok: true })),
    };
    const cleanup = installArtPlayerControlBridge(player, () => controller);
    cleanup();
    expect(player.play).toBe(originalPlay);
    expect(player.pause).toBe(originalPause);
    player.currentTime = 17;
    expect(readTime()).toBe(17);
  });
});
