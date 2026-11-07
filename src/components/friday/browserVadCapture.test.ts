import { describe, expect, it, vi } from "vitest";
import {
  calculateAudioRms,
  createBrowserVadCapture,
} from "./browserVadCapture";

describe("browser VAD microphone capture", () => {
  it("calculates frame RMS and treats an empty frame as silence", () => {
    expect(calculateAudioRms(new Float32Array())).toBe(0);
    expect(calculateAudioRms(new Float32Array([1, -1, 1, -1]))).toBe(1);
    expect(calculateAudioRms(new Float32Array([0.5, -0.5]))).toBe(0.5);
  });

  it("acquires a processed audio stream and releases every resource on stop", async () => {
    const trackStop = vi.fn();
    const sourceConnect = vi.fn();
    const sourceDisconnect = vi.fn();
    const analyserDisconnect = vi.fn();
    const close = vi.fn(async () => {});
    const resume = vi.fn(async () => {});
    const getFloatTimeDomainData = vi.fn((buffer: Float32Array) => buffer.fill(0));
    const requestFrame = vi.fn(() => 17);
    const cancelFrame = vi.fn();
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream));
    const analyser = {
      fftSize: 0,
      getFloatTimeDomainData,
      disconnect: analyserDisconnect,
    };
    const audioContext = {
      state: "running",
      resume,
      close,
      createMediaStreamSource: () => ({
        connect: sourceConnect,
        disconnect: sourceDisconnect,
      }),
      createAnalyser: () => analyser,
    };

    const capture = createBrowserVadCapture({
      onEvent: vi.fn(),
      mediaDevices: { getUserMedia },
      createAudioContext: () => audioContext as unknown as AudioContext,
      requestFrame,
      cancelFrame,
      now: () => 10,
    });

    await capture.start();
    expect(capture.isRunning()).toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    expect(analyser.fftSize).toBe(2048);
    expect(sourceConnect).toHaveBeenCalledWith(analyser);
    expect(requestFrame).toHaveBeenCalledTimes(1);

    await capture.stop();
    expect(capture.isRunning()).toBe(false);
    expect(cancelFrame).toHaveBeenCalledWith(17);
    expect(sourceDisconnect).toHaveBeenCalledTimes(1);
    expect(analyserDisconnect).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stops a stream that resolves after capture was cancelled", async () => {
    const trackStop = vi.fn();
    let resolveStream!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    }));
    const capture = createBrowserVadCapture({
      onEvent: vi.fn(),
      mediaDevices: { getUserMedia },
      createAudioContext: vi.fn(),
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    });

    const starting = capture.start();
    await capture.stop();
    resolveStream({
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream);
    await starting;

    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(capture.isRunning()).toBe(false);
  });

  it("cleans up the acquired stream when Web Audio initialization fails", async () => {
    const trackStop = vi.fn();
    const onError = vi.fn();
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream));
    const failure = new Error("AudioContext unavailable");
    const capture = createBrowserVadCapture({
      onEvent: vi.fn(),
      onError,
      mediaDevices: { getUserMedia },
      createAudioContext: () => {
        throw failure;
      },
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    });

    await expect(capture.start()).rejects.toThrow("AudioContext unavailable");
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(capture.isRunning()).toBe(false);
  });
});
