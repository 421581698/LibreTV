import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

type Processor = {
  port: { onmessage?: (event: { data: unknown }) => void };
  queue: unknown[];
  queuedFrames: number;
  expectedPtsSamples: number | null;
  process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
};

function setup() {
  const registered: { create?: () => Processor } = {};
  const events: Array<{ type: string; frames?: number }> = [];
  class AudioWorkletProcessorStub {
    port = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
      postMessage: (data: { type: string; frames?: number }) => events.push(data) };
  }
  const source = readFileSync('public/audio/openjoc-pcm.worklet.js', 'utf8');
  runInNewContext(source, {
    AudioWorkletProcessor: AudioWorkletProcessorStub,
    Float32Array,
    registerProcessor: (_name: string, ctor: new () => Processor) => { registered.create = () => new ctor(); },
  });
  if (!registered.create) throw new Error('PCM worklet was not registered.');
  const processor = registered.create();
  const send = (data: unknown) => processor.port.onmessage?.({ data });
  const quantum = (frames = 128) => {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    processor.process([], [[left, right]]);
    return { left, right };
  };
  return { processor, send, quantum, events };
}

describe('OpenJOC PCM worklet media clock', () => {
  it('inserts silence before future PCM rather than playing it early', () => {
    const { send, quantum, processor } = setup();
    send({ type: 'clock', ptsSamples: 0 });
    send({ type: 'pcm', samples: new Float32Array(256).fill(0.75), sampleRate: 48000, channels: 2, ptsSamples: 64 });
    send({ type: 'start' });
    const { left } = quantum();
    expect([...left.slice(0, 64)]).toEqual(Array(64).fill(0));
    expect([...left.slice(64)]).toEqual(Array(64).fill(0.75));
    expect(processor.queuedFrames).toBe(64);
    expect(processor.expectedPtsSamples).toBe(128);
  });

  it('drops stale PCM and plays the correct sample when media clock is ahead', () => {
    const { send, quantum, processor } = setup();
    send({ type: 'clock', ptsSamples: 40 });
    const samples = new Float32Array(256);
    for (let i = 0; i < 128; i++) { samples[i * 2] = i / 128; samples[i * 2 + 1] = i / 128; }
    send({ type: 'pcm', samples, sampleRate: 48000, channels: 2, ptsSamples: 0 });
    send({ type: 'start' });
    const { left } = quantum(16);
    expect(left[0]).toBeCloseTo(40 / 128);
    expect(processor.queuedFrames).toBe(72);
  });

  it('advances the sample clock through silent quanta and clears stale queued audio', () => {
    const { send, quantum, processor, events } = setup();
    send({ type: 'clock', ptsSamples: 0 });
    send({ type: 'start' });
    quantum();
    expect(processor.expectedPtsSamples).toBe(128);
    send({ type: 'pcm', samples: new Float32Array(256).fill(1), sampleRate: 48000, channels: 2, ptsSamples: 128 });
    send({ type: 'clear' });
    expect(quantum().left.every(sample => sample === 0)).toBe(true);
    expect(processor.queuedFrames).toBe(0);
    expect(events.some(event => event.type === 'started')).toBe(false);
  });

  it('fails closed instead of playing stale PCM after a large media-clock jump', () => {
    const { send, quantum, events } = setup();
    send({ type: 'clock', ptsSamples: 0 });
    send({ type: 'pcm', samples: new Float32Array(256).fill(1), sampleRate: 48000, channels: 2, ptsSamples: 0 });
    send({ type: 'start' });
    quantum();
    send({ type: 'clock', ptsSamples: 48000 });
    expect(quantum().left.every(sample => sample === 0)).toBe(true);
    expect(events.filter(event => event.type === 'clock-discontinuity')).toHaveLength(1);
  });

  it('does not repeatedly correct against an unchanged video clock measurement', () => {
    const { send, quantum, processor, events } = setup();
    send({ type: 'clock', ptsSamples: 0 });
    send({ type: 'pcm', samples: new Float32Array(8192).fill(0.5), sampleRate: 48000, channels: 2, ptsSamples: 0 });
    send({ type: 'start' });
    for (let i = 0; i < 32; i++) {
      expect(quantum().left.every(sample => sample === 0.5)).toBe(true);
    }
    expect(processor.expectedPtsSamples).toBe(4096);
    expect(events.some(event => event.type === 'clock-discontinuity')).toBe(false);
  });

  it('maintains bounded queue and sample alignment over simulated ten-minute playback', () => {
    const { send, quantum, processor, events } = setup();
    const frames = 48000 * 600;
    const samples = new Float32Array(256).fill(0.25);
    send({ type: 'clock', ptsSamples: 0 });
    send({ type: 'start' });
    for (let pts = 0; pts < frames; pts += 128) {
      if (pts % 2048 === 0) send({ type: 'clock', ptsSamples: pts });
      send({ type: 'pcm', samples, sampleRate: 48000, channels: 2, ptsSamples: pts });
      const { left } = quantum();
      if (left[0] !== 0.25 || left[127] !== 0.25 || processor.queuedFrames !== 0) {
        throw new Error('PCM alignment or queue regression at sample ' + pts);
      }
      events.length = 0;
    }
    expect(processor.expectedPtsSamples).toBe(frames);
  }, 30000);

  it('detects prolonged underrun after output started', () => {
    const { send, quantum, events } = setup();
    send({ type: 'clock', ptsSamples: 0 });
    send({ type: 'pcm', samples: new Float32Array(256).fill(1), sampleRate: 48000, channels: 2, ptsSamples: 0 });
    send({ type: 'start' });
    quantum();
    for (let i = 0; i < 12; i++) quantum();
    expect(events.filter(event => event.type === 'underrun')).toHaveLength(1);
  });
});
