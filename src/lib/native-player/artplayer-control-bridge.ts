import type { BackendCommandResult } from './backend-contract';

export interface PlaybackCommandPort {
  play(): Promise<BackendCommandResult>;
  pause(): BackendCommandResult;
  seek(seconds: number): BackendCommandResult;
}

function succeeded(result: BackendCommandResult | null | undefined): boolean {
  return Boolean(result?.ok);
}

function shouldFallback(result: BackendCommandResult | null | undefined): boolean {
  return !result || (!result.ok && (result.reason === 'unsupported' || result.reason === 'not-ready'));
}

function commandError(result: BackendCommandResult): Error {
  return new Error(result.ok ? 'Playback controller command failed.' : result.error?.message ?? `Playback controller command failed: ${result.reason}`);
}

function findDescriptor(target: object, property: PropertyKey): PropertyDescriptor | undefined {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

/**
 * Route ArtPlayer's underlying HTMLVideoElement commands through Cinema's
 * controller while leaving ArtPlayer's own non-configurable public methods
 * untouched. A re-entrancy guard lets the controller call the native media
 * methods without routing back into itself.
 */
export function installArtPlayerControlBridge(
  video: HTMLVideoElement,
  getController: () => PlaybackCommandPort | null,
): () => void {
  const ownPlay = Object.getOwnPropertyDescriptor(video, 'play');
  const ownPause = Object.getOwnPropertyDescriptor(video, 'pause');
  const ownTime = Object.getOwnPropertyDescriptor(video, 'currentTime');
  const timeDescriptor = findDescriptor(video, 'currentTime');
  if (!timeDescriptor?.get || !timeDescriptor.set) return () => undefined;

  const originalPlay = video.play.bind(video);
  const originalPause = video.pause.bind(video);
  let controllerCommandDepth = 0;

  const executeControllerAsync = async <T>(command: () => Promise<T>): Promise<T> => {
    // Keep the re-entrancy guard only around the synchronous call into the
    // controller. Its backend reaches video.play() before yielding; holding
    // the guard until that Promise settles would let concurrent pause/seek
    // commands bypass the controller while playback startup is pending.
    let pending: Promise<T>;
    controllerCommandDepth += 1;
    try {
      pending = command();
    } finally {
      controllerCommandDepth -= 1;
    }
    return await pending;
  };

  const executeControllerSync = <T>(command: () => T): T => {
    controllerCommandDepth += 1;
    try {
      return command();
    } finally {
      controllerCommandDepth -= 1;
    }
  };

  try {
    Object.defineProperty(video, 'play', {
      configurable: true,
      enumerable: ownPlay?.enumerable ?? false,
      writable: true,
      value: async () => {
        if (controllerCommandDepth > 0) return originalPlay();
        const controller = getController();
        if (!controller) return originalPlay();
        let result: BackendCommandResult;
        try {
          result = await executeControllerAsync(() => controller.play());
        } catch {
          return originalPlay();
        }
        if (succeeded(result)) return;
        if (shouldFallback(result)) return originalPlay();
        throw commandError(result);
      },
    });

    Object.defineProperty(video, 'pause', {
      configurable: true,
      enumerable: ownPause?.enumerable ?? false,
      writable: true,
      value: () => {
        if (controllerCommandDepth > 0) return originalPause();
        const controller = getController();
        if (!controller) return originalPause();
        let result: BackendCommandResult;
        try {
          result = executeControllerSync(() => controller.pause());
        } catch {
          return originalPause();
        }
        if (succeeded(result)) return;
        if (shouldFallback(result)) return originalPause();
        throw commandError(result);
      },
    });

    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      enumerable: timeDescriptor.enumerable ?? false,
      get: () => timeDescriptor.get!.call(video),
      set: (value: number) => {
        if (controllerCommandDepth > 0) {
          timeDescriptor.set!.call(video, value);
          return;
        }
        const seconds = Number(value);
        const controller = getController();
        if (controller && Number.isFinite(seconds)) {
          let result: BackendCommandResult;
          try {
            result = executeControllerSync(() => controller.seek(seconds));
          } catch {
            timeDescriptor.set!.call(video, value);
            return;
          }
          if (succeeded(result)) return;
          if (!shouldFallback(result)) throw commandError(result);
        }
        timeDescriptor.set!.call(video, value);
      },
    });
  } catch {
    // Restore a partially installed bridge if a browser exposes a sealed media element.
    if (ownPlay) Object.defineProperty(video, 'play', ownPlay);
    else Reflect.deleteProperty(video, 'play');
    if (ownPause) Object.defineProperty(video, 'pause', ownPause);
    else Reflect.deleteProperty(video, 'pause');
    if (ownTime) Object.defineProperty(video, 'currentTime', ownTime);
    else Reflect.deleteProperty(video, 'currentTime');
    return () => undefined;
  }

  return () => {
    if (ownPlay) Object.defineProperty(video, 'play', ownPlay);
    else Reflect.deleteProperty(video, 'play');
    if (ownPause) Object.defineProperty(video, 'pause', ownPause);
    else Reflect.deleteProperty(video, 'pause');
    if (ownTime) Object.defineProperty(video, 'currentTime', ownTime);
    else Reflect.deleteProperty(video, 'currentTime');
  };
}
