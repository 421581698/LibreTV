import type { BackendCommandResult } from './backend-contract';

export interface PlaybackCommandPort {
  play(): Promise<BackendCommandResult>;
  pause(): BackendCommandResult;
  seek(seconds: number): BackendCommandResult;
}

export interface ArtPlayerCommandSurface {
  play(): unknown;
  pause(): unknown;
  currentTime: number;
}

function succeeded(result: BackendCommandResult | null | undefined): boolean {
  return Boolean(result?.ok);
}

/**
 * Make ArtPlayer the presentation/control-surface fallback while routing its
 * public play/pause/currentTime commands through the Cinema controller whenever
 * an observed session is active. The controller still acts on ArtPlayer's
 * existing HTMLMediaElement; it does not create or replace a media pipeline.
 */
export function installArtPlayerControlBridge(
  player: ArtPlayerCommandSurface,
  getController: () => PlaybackCommandPort | null,
): () => void {
  const originalPlay = player.play.bind(player);
  const originalPause = player.pause.bind(player);
  const ownDescriptor = Object.getOwnPropertyDescriptor(player, 'currentTime');
  let prototype = Object.getPrototypeOf(player) as object | null;
  let inheritedDescriptor: PropertyDescriptor | undefined;
  while (prototype && !inheritedDescriptor) {
    inheritedDescriptor = Object.getOwnPropertyDescriptor(prototype, 'currentTime');
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  const originalTimeDescriptor = ownDescriptor ?? inheritedDescriptor;

  player.play = async () => {
    const controller = getController();
    if (!controller) return originalPlay();
    const result = await controller.play();
    if (succeeded(result)) return undefined;
    return originalPlay();
  };

  player.pause = () => {
    const controller = getController();
    if (controller && succeeded(controller.pause())) return undefined;
    return originalPause();
  };

  let timeBridgeInstalled = false;
  try {
    Object.defineProperty(player, 'currentTime', {
      configurable: true,
      enumerable: originalTimeDescriptor?.enumerable ?? true,
      get: () => originalTimeDescriptor?.get
        ? originalTimeDescriptor.get.call(player)
        : originalTimeDescriptor?.value,
      set: (seconds: number) => {
        const controller = getController();
        if (controller && succeeded(controller.seek(seconds))) return;
        if (originalTimeDescriptor?.set) {
          originalTimeDescriptor.set.call(player, seconds);
        } else if (player && 'video' in player) {
          const video = (player as ArtPlayerCommandSurface & { video?: HTMLMediaElement }).video;
          if (video) video.currentTime = seconds;
        }
      },
    });
    timeBridgeInstalled = true;
  } catch {
    // Some ArtPlayer builds may expose a non-configurable accessor. play/pause
    // still use the controller; the original seek surface remains intact.
  }

  return () => {
    player.play = originalPlay;
    player.pause = originalPause;
    if (timeBridgeInstalled) {
      try {
        if (ownDescriptor) Object.defineProperty(player, 'currentTime', ownDescriptor);
        else Reflect.deleteProperty(player, 'currentTime');
      } catch {
        // Player destruction follows immediately; no further commands are issued.
      }
    }
  };
}
