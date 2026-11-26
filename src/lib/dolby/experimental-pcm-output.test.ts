import { describe, expect, it, vi } from 'vitest';
import { ExperimentalPcmOutput } from './experimental-pcm-output';
import type { ExperimentalPcm } from './openjoc-experimental-decoder';

function setup() {
  const channels = [new Float32Array(2), new Float32Array(2)];
  const start = vi.fn();
  const stop = vi.fn();
  const disconnect = vi.fn();
  const source = {
    buffer: null as unknown,
    playbackRate: { value: 1 },
    connect: vi.fn(),
    disconnect,
    start,
    stop,
    onended: null as (() => void) | null,
  };
  const createBuffer = vi.fn(() => ({
    duration: 2 / 48000,
    getChannelData: (channel: number) => channels[channel],
  }));
  const createBufferSource = vi.fn(() => source);
  const context = {
    state: 'running',
    currentTime: 10,
    createBuffer,
    createBufferSource,
  } as unknown as AudioContext;
  const destination = {} as AudioNode;
  const output = new ExperimentalPcmOutput(context, destination);
  const frame: ExperimentalPcm = {
    pcm: new Float32Array([0.5, -0.5, 0.25, -0.25]),
    samples: 2, channels: 2, sampleRate: 48000, ptsSamples: 48000n,
  };
  return { output, frame, source, channels, createBuffer, createBufferSource, start, stop, disconnect };
}

describe('isolated experimental PCM output', () => {
  it('schedules valid interleaved stereo without touching native playback', () => {
    const { output, frame, channels, createBuffer, start } = setup();
    expect(output.enqueue(frame, 1, 1)).toBe('schedule');
    expect(createBuffer).toHaveBeenCalledWith(2, 2, 48000);
    expect(Array.from(channels[0])).toEqual([0.5, 0.25]);
    expect(Array.from(channels[1])).toEqual([-0.5, -0.25]);
    expect(start).toHaveBeenCalledWith(10);
  });

  it('rejects malformed samples before Web Audio allocation', () => {
    const { output, frame, createBuffer } = setup();
    const invalid: ExperimentalPcm[] = [
      { ...frame, samples: 3 },
      { ...frame, channels: 1.5 },
      { ...frame, sampleRate: 100 },
      { ...frame, pcm: new Float32Array([0.5, Number.NaN, 0.25, -0.25]) },
      { ...frame, pcm: new Float32Array([0.5, Number.POSITIVE_INFINITY, 0.25, -0.25]) },
      { ...frame, samples: 262145 },
    ];
    for (const broken of invalid) expect(output.enqueue(broken, 1, 1)).toBe('reset');
    expect(createBuffer).not.toHaveBeenCalled();
  });

  it('stops queued audio on malformed PCM and permits valid audio to resume', () => {
    const { output, frame, source, stop, disconnect, createBuffer } = setup();
    expect(output.enqueue(frame, 1, 1)).toBe('schedule');
    expect(output.enqueue({ ...frame, samples: 3 }, 1, 1)).toBe('reset');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(source.onended).toBeNull();
    expect(createBuffer).toHaveBeenCalledTimes(1);
    expect(output.enqueue(frame, 1, 1)).toBe('schedule');
  });

  it('cleans up a failed source start and permits a retry', () => {
    const { output, frame, source, start, disconnect } = setup();
    start.mockImplementationOnce(() => { throw new Error('audio device unavailable'); });
    expect(output.enqueue(frame, 1, 1)).toBe('reset');
    expect(source.onended).toBeNull();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(output.enqueue(frame, 1, 1)).toBe('schedule');
  });

  it('returns reset when buffer allocation fails and allows retry', () => {
    const { output, frame, createBuffer } = setup();
    createBuffer.mockImplementationOnce(() => { throw new Error('allocation failed'); });
    expect(output.enqueue(frame, 1, 1)).toBe('reset');
    expect(output.enqueue(frame, 1, 1)).toBe('schedule');
  });

  it('clears scheduling state even when disconnect throws', () => {
    const { output, frame, disconnect } = setup();
    expect(output.enqueue(frame, 1, 1)).toBe('schedule');
    disconnect.mockImplementationOnce(() => { throw new Error('already disconnected'); });
    expect(() => output.reset()).not.toThrow();
    expect(output.enqueue(frame, 1, 1)).toBe('schedule');
  });

  it('stops and disconnects experimental sources on reset', () => {
    const { output, frame, source, stop, disconnect } = setup();
    expect(output.enqueue(frame, 1, 1)).toBe('schedule');
    output.reset();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(source.onended).toBeNull();
  });
});
