import { describe, expect, it, vi } from 'vitest';
import Hls from 'hls.js';
import { bindExperimentalHlsAudio } from './bind-experimental-hls-audio';

vi.mock('./openjoc-experimental-decoder', () => ({
  OpenJocExperimentalDecoder: class {
    private frames = 0;
    push() { this.frames = 1; return 0; }
    receive() {
      if (!this.frames) return null;
      this.frames = 0;
      return { pcm: new Float32Array([0.1]), samples: 1, channels: 1,
        sampleRate: 48000, ptsSamples: 0n };
    }
    reset() { this.frames = 0; }
    close() {}
  },
}));
vi.mock('./experimental-pcm-output', () => ({
  ExperimentalPcmOutput: class {
    enqueue() { return 'schedule'; }
    reset() {}
  },
}));
vi.mock('./experimental-hls-audio-input', () => ({
  ExperimentalHlsAudioInput: class {
    constructor(private readonly session: { push: (b: Uint8Array, pts: bigint) => boolean }) {}
    begin() { return 1; }
    push() { return this.session.push(new Uint8Array([1]), 0n); }
  },
}));
function fixture() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const hls = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(cb);
    }),
    off: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(cb);
    }),
  };
  const video = Object.assign(new EventTarget(), {
    paused: false, muted: false, volume: 1, currentTime: 0, playbackRate: 1,
  }) as HTMLVideoElement;
  const onFailure = vi.fn();
  const close = bindExperimentalHlsAudio({
    hls: hls as unknown as Hls, video,
    abi: {} as Parameters<typeof bindExperimentalHlsAudio>[0]['abi'],
    context: { state: 'running', destination: {} } as AudioContext,
    origin90k: 0, isCurrent: () => true, onFailure,
  });
  const emit = (event: string, payload: unknown) => {
    listeners.get(event)?.forEach(cb => cb(event, payload));
  };
  return { video, close, hls, emit, onFailure, listeners };
}
describe('real HLS event / experimental PCM lifecycle wiring', () => {
  it('muting native audio after a scheduled PCM frame does not close its own session', () => {
    const f = fixture();
    f.emit(Hls.Events.FRAG_LOADED, {
      frag: { type: 'audio', sn: 0, level: 0, cc: 0 },
      payload: new Uint8Array(188).buffer,
    });
    expect(f.video.muted).toBe(true);
    f.video.dispatchEvent(new Event('volumechange')); // native mute owned by session
    expect(f.onFailure).not.toHaveBeenCalled();
    f.video.dispatchEvent(new Event('pause'));
    expect(f.video.muted).toBe(false);
    expect(f.hls.off).toHaveBeenCalledWith(Hls.Events.FRAG_LOADED, expect.any(Function));
  });
  it('stops scheduled PCM before restoring native audio after a later failure', () => {
    const f = fixture();
    f.emit(Hls.Events.FRAG_LOADED, {
      frag: { type: 'audio', sn: 0, level: 0, cc: 0 },
      payload: new Uint8Array(188).buffer,
    });
    expect(f.video.muted).toBe(true);
    f.emit(Hls.Events.FRAG_LOADED, {
      frag: { type: 'audio', sn: 1, level: 0, cc: 0, decryptdata: { method: 'SAMPLE-AES' } },
      payload: new Uint8Array(188).buffer,
    });
    expect(f.video.muted).toBe(false);
    expect(f.onFailure).toHaveBeenCalledTimes(1);
  });
  it('rejects encrypted HLS audio and restores native audio once', () => {
    const f = fixture();
    f.emit(Hls.Events.FRAG_LOADED, {
      frag: { type: 'audio', sn: 0, level: 0, cc: 0, decryptdata: { method: 'AES-128' } },
      payload: new Uint8Array(188).buffer,
    });
    expect(f.onFailure).toHaveBeenCalledTimes(1);
    f.close();
    expect(f.onFailure).toHaveBeenCalledTimes(1);
  });
});
