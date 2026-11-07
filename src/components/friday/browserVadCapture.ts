import {
  createVoiceActivityDetector,
  type VoiceActivityEvent,
  type VoiceActivityDetectorOptions,
} from "./voiceActivityDetector";

type AudioContextLike = Pick<
  AudioContext,
  "createMediaStreamSource" | "createAnalyser" | "resume" | "close" | "state"
>;
type AnalyserLike = Pick<AnalyserNode, "fftSize" | "getFloatTimeDomainData" | "disconnect">;
type SourceLike = Pick<MediaStreamAudioSourceNode, "connect" | "disconnect">;

export type BrowserVadCaptureOptions = {
  onEvent: (event: VoiceActivityEvent) => void;
  onError?: (error: Error) => void;
  /** Normalized RMS level (0..1) sampled from the same analyser used by VAD. */
  onAudioLevel?: (level: number) => void;
  detector?: VoiceActivityDetectorOptions;
  mediaDevices?: Pick<MediaDevices, "getUserMedia">;
  createAudioContext?: () => AudioContextLike;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
};

export type BrowserVadCapture = {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
};

/** Root-mean-square level for one Web Audio time-domain frame. */
export function calculateAudioRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples.length);
}

/**
 * Owns a microphone stream solely for VAD sampling.
 *
 * Do not run this concurrently with browser SpeechRecognition on Safari/iOS:
 * Web Speech does not expose its captured MediaStream, so callers must
 * serialize VAD capture and native ASR capture (stop VAD before ASR starts).
 */
export function createBrowserVadCapture(
  options: BrowserVadCaptureOptions,
): BrowserVadCapture {
  const detector = createVoiceActivityDetector(options.detector);
  const getMediaDevices = () =>
    options.mediaDevices ??
    (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);
  const createAudioContext = () => {
    if (options.createAudioContext) return options.createAudioContext();
    if (typeof window === "undefined") {
      throw new Error("Web Audio is unavailable outside a browser");
    }
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported by this browser");
    return new AudioContextClass();
  };
  const requestFrame =
    options.requestFrame ??
    (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame.bind(globalThis)
      : undefined);
  const cancelFrame =
    options.cancelFrame ??
    (typeof cancelAnimationFrame === "function"
      ? cancelAnimationFrame.bind(globalThis)
      : undefined);
  const now = options.now ?? (() => performance.now());

  let stream: MediaStream | null = null;
  let context: AudioContextLike | null = null;
  let source: SourceLike | null = null;
  let analyser: AnalyserLike | null = null;
  let frameHandle: number | null = null;
  let running = false;
  let starting: Promise<void> | null = null;
  let generation = 0;

  const cleanup = async () => {
    running = false;
    generation += 1;
    if (frameHandle !== null) {
      cancelFrame?.(frameHandle);
      frameHandle = null;
    }
    try {
      source?.disconnect();
    } catch {
      // A node may already have been disconnected by the browser.
    }
    try {
      analyser?.disconnect();
    } catch {
      // A node may already have been disconnected by the browser.
    }
    source = null;
    analyser = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    const currentContext = context;
    context = null;
    if (currentContext && currentContext.state !== "closed") {
      try {
        await currentContext.close();
      } catch {
        // Closing an already-suspended context can reject on some browsers.
      }
    }
    detector.reset();
  };

  const sample = (runId: number, buffer: Float32Array<ArrayBuffer>) => {
    if (!running || runId !== generation || !analyser) return;
    analyser.getFloatTimeDomainData(buffer);
    const level = calculateAudioRms(buffer);
    try {
      options.onAudioLevel?.(Math.min(1, level));
    } catch {
      // Visual metering must never interrupt microphone capture or VAD timing.
    }
    for (const event of detector.pushLevel(level, now())) {
      options.onEvent(event);
    }
    if (running && runId === generation && requestFrame) {
      frameHandle = requestFrame(() => sample(runId, buffer));
    }
  };

  return {
    async start() {
      if (running) return;
      if (starting) return starting;
      if (!requestFrame || !cancelFrame) {
        throw new Error("Animation frame scheduling is unavailable");
      }
      const mediaDevices = getMediaDevices();
      if (!mediaDevices?.getUserMedia) {
        throw new Error("Microphone capture is not supported by this browser");
      }

      const startToken = generation;
      const startPromise = (async () => {
        try {
          const acquiredStream = await mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          if (startToken !== generation) {
            acquiredStream.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = acquiredStream;
          const audioContext = createAudioContext();
          context = audioContext;
          if (audioContext.state === "suspended") await audioContext.resume();
          if (startToken !== generation) return;
          const mediaSource = audioContext.createMediaStreamSource(acquiredStream);
          source = mediaSource;
          const audioAnalyser = audioContext.createAnalyser();
          analyser = audioAnalyser;
          audioAnalyser.fftSize = 2048;
          mediaSource.connect(audioAnalyser);

          running = true;
          const runId = ++generation;
          sample(runId, new Float32Array(new ArrayBuffer(audioAnalyser.fftSize * Float32Array.BYTES_PER_ELEMENT)));
        } catch (cause) {
          await cleanup();
          const error = cause instanceof Error ? cause : new Error("Unable to start microphone VAD");
          options.onError?.(error);
          throw error;
        }
      })();
      starting = startPromise;
      try {
        await startPromise;
      } finally {
        if (starting === startPromise) starting = null;
      }
    },

    async stop() {
      await cleanup();
    },

    isRunning() {
      return running;
    },
  };
}
