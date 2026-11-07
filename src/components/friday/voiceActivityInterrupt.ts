import {
  createBrowserVadCapture,
  type BrowserVadCapture,
  type BrowserVadCaptureOptions,
} from "./browserVadCapture";

export type VoiceActivityInterruptController = {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  isArmed(): boolean;
};

export type VoiceActivityInterruptOptions = {
  onInterrupt: () => void | Promise<void>;
  onError?: BrowserVadCaptureOptions["onError"];
  createCapture?: (options: BrowserVadCaptureOptions) => BrowserVadCapture;
  captureOptions?: Omit<BrowserVadCaptureOptions, "onEvent" | "onError">;
  /** True only after this session has successfully opened the browser ASR microphone. */
  hasPriorMicGrant?: () => boolean;
};

/**
 * One-shot acoustic TTS interruption.
 *
 * Intended to be armed only while TTS is playing and microphone permission is
 * already granted. It stops its capture before invoking onInterrupt, so the
 * caller can safely start browser SpeechRecognition without two simultaneous
 * microphone owners. Unsupported permission-query environments should leave
 * this feature disarmed and retain the manual interrupt control.
 */
export function createVoiceActivityInterruptController(
  options: VoiceActivityInterruptOptions,
): VoiceActivityInterruptController {
  const createCapture = options.createCapture ?? createBrowserVadCapture;
  let capture: BrowserVadCapture | null = null;
  let armed = false;
  let interrupted = false;
  let generation = 0;
  let starting: Promise<boolean> | null = null;

  const disarm = async () => {
    armed = false;
    generation += 1;
    starting = null;
    const current = capture;
    capture = null;
    await current?.stop();
  };

  return {
    start() {
      if (armed) return Promise.resolve(true);
      if (starting) return starting;
      const runId = ++generation;
      const startPromise = (async () => {
        if (typeof navigator === "undefined") return false;

        const permissionQuery = navigator.permissions?.query;
        if (permissionQuery) {
          try {
            const permission = await permissionQuery.call(navigator.permissions, {
              name: "microphone" as PermissionName,
            });
            if (runId !== generation || permission.state !== "granted") return false;
          } catch {
            if (runId !== generation || !options.hasPriorMicGrant?.()) return false;
          }
        } else if (!options.hasPriorMicGrant?.()) {
          return false;
        }
        if (runId !== generation) return false;

        interrupted = false;
        let nextCapture: BrowserVadCapture;
        try {
          nextCapture = createCapture({
            ...options.captureOptions,
            onError: options.onError,
            onEvent: (event) => {
              if (event.type !== "speechstart" || !armed || interrupted || runId !== generation) {
                return;
              }
              interrupted = true;
              armed = false;
              const current = capture;
              capture = null;
              void current?.stop().then(async () => {
                if (runId === generation) await options.onInterrupt();
              }).catch((error: unknown) => {
                options.onError?.(error instanceof Error ? error : new Error("VAD interruption failed"));
              });
            },
          });
        } catch (error) {
          options.onError?.(error instanceof Error ? error : new Error("Unable to create VAD capture"));
          return false;
        }
        capture = nextCapture;
        try {
          await nextCapture.start();
          if (runId !== generation) {
            // stop() already owns cleanup when it invalidates an in-flight start.
            return false;
          }
          armed = true;
          return true;
        } catch {
          if (capture === nextCapture) capture = null;
          armed = false;
          return false;
        }
      })();
      starting = startPromise;
      void startPromise.then(
        () => {
          if (starting === startPromise) starting = null;
        },
        () => {
          if (starting === startPromise) starting = null;
        },
      );
      return startPromise;
    },

    async stop() {
      await disarm();
    },

    isArmed() {
      return armed;
    },
  };
}
