import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperimentalHlsAudioController } from './experimental-hls-audio-controller';
import { bindExperimentalHlsAudio } from './bind-experimental-hls-audio';
vi.mock('./openjoc-user-wasm', () => ({ loadUserOpenJocWasm: vi.fn(async () => ({})) }));
vi.mock('./bind-experimental-hls-audio', () => ({ bindExperimentalHlsAudio: vi.fn(() => vi.fn()) }));
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
describe('per-source experimental HLS audio authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
      destination = {};
    });
  });
  it('does not load or bind without user opt-in, and resets across transport lifecycle', async () => {
    const status = vi.fn();
    const player = new ExperimentalHlsAudioController(status);
    const hls = {} as Parameters<typeof player.setSource>[0];
    const video = { paused: false, muted: false } as HTMLVideoElement;
    player.setSource(hls, video, () => true);
    player.onResume();
    expect(bindExperimentalHlsAudio).not.toHaveBeenCalled();
    player.enable(new File([new Uint8Array(16)], 'decoder.wasm'), 0);
    await flush();
    expect(bindExperimentalHlsAudio).toHaveBeenCalledTimes(1);
    const close = vi.mocked(bindExperimentalHlsAudio).mock.results[0].value as () => void;
    player.onInterruption();
    expect(close).toHaveBeenCalledOnce();
    expect(player.enabled).toBe(true);
    player.onResume();
    await flush();
    expect(bindExperimentalHlsAudio).toHaveBeenCalledTimes(2);
    player.onSourceChange();
    expect(player.enabled).toBe(false);
    player.onResume();
    await flush();
    expect(bindExperimentalHlsAudio).toHaveBeenCalledTimes(2);
  });
  it('does not attach a late WASM load after its playback source is gone', async () => {
    const player = new ExperimentalHlsAudioController(vi.fn());
    player.setSource({} as Parameters<typeof player.setSource>[0],
      { paused: false, muted: false } as HTMLVideoElement, () => true);
    player.enable(new File([new Uint8Array(16)], 'decoder.wasm'), 0);
    player.onSourceChange();
    await flush();
    expect(player.enabled).toBe(false);
    expect(bindExperimentalHlsAudio).not.toHaveBeenCalled();
  });
  it('disables consent and restores native audio after decoder failure', async () => {
    const status = vi.fn();
    const player = new ExperimentalHlsAudioController(status);
    player.setSource({} as Parameters<typeof player.setSource>[0],
      { paused: false, muted: false } as HTMLVideoElement, () => true);
    player.enable(new File([new Uint8Array(16)], 'decoder.wasm'), 0);
    await flush();
    const opts = vi.mocked(bindExperimentalHlsAudio).mock.calls[0][0];
    opts.onFailure?.();
    expect(player.enabled).toBe(false);
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('已恢复原生播放'), false);
  });
  it('rejects invalid timebase and paused playback, preserving native audio', async () => {
    const player = new ExperimentalHlsAudioController(vi.fn());
    const video = { paused: true, muted: false } as HTMLVideoElement;
    player.setSource({} as Parameters<typeof player.setSource>[0], video, () => true);
    const file = new File([new Uint8Array(16)], 'decoder.wasm');
    player.enable(file, 0.5);
    expect(player.enabled).toBe(false);
    player.enable(file, 0);
    await flush();
    expect(bindExperimentalHlsAudio).not.toHaveBeenCalled();
    player.disable();
    expect(player.enabled).toBe(false);
  });
});
