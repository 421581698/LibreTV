import { describe, expect, it, vi } from 'vitest';
import { ExperimentalHlsAudioInput } from './experimental-hls-audio-input';
vi.mock('./ec3-psi', () => ({ discoverEc3Pid: () => 256 }));
vi.mock('./experimental-ts-audio-input', () => ({
  ExperimentalTsAudioInput: class { pushSegment() { return true; } },
}));
describe('generation-scoped HLS audio input', () => {
  it('ignores stale generations and duplicate fragment identities', () => {
    const session = { push: vi.fn(), fail: vi.fn(), onSourceChange: vi.fn() };
    const input = new ExperimentalHlsAudioInput(session);
    const first = input.begin();
    const second = input.begin();
    expect(input.push(first, 'old', new Uint8Array(188), 0)).toBe(false);
    expect(input.push(second, 'new', new Uint8Array(188), 0)).toBe(true);
    expect(input.push(second, 'new', new Uint8Array(188), 0)).toBe(true);
    expect(session.onSourceChange).toHaveBeenCalledTimes(2);
    expect(session.fail).not.toHaveBeenCalled();
  });
  it('fails closed when the media origin changes', () => {
    const session = { push: vi.fn(), fail: vi.fn(), onSourceChange: vi.fn() };
    const input = new ExperimentalHlsAudioInput(session);
    const generation = input.begin();
    expect(input.push(generation, 'a', new Uint8Array(188), 0)).toBe(true);
    expect(input.push(generation, 'b', new Uint8Array(188), 1)).toBe(false);
    expect(session.fail).toHaveBeenCalledTimes(1);
  });
});
