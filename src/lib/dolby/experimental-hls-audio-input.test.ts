import { describe, expect, it, vi } from 'vitest';
import { ExperimentalHlsAudioInput } from './experimental-hls-audio-input';
import { discoverEc3Pid } from './ec3-psi';
vi.mock('./ec3-psi', () => ({ discoverEc3Pid: vi.fn((): number | null => 256) }));
vi.mock('./experimental-ts-audio-input', () => ({
  ExperimentalTsAudioInput: class { pushSegment() { return true; } },
}));
function audioPacket() {
  const bytes = new Uint8Array(188);
  bytes.set([0x47, 0x01, 0x00, 0x10]); // selected PID 256
  return bytes;
}
describe('generation-scoped HLS audio input', () => {
  it('ignores stale generations and duplicate fragment identities', () => {
    const session = { push: vi.fn(), fail: vi.fn(), onSourceChange: vi.fn() };
    const input = new ExperimentalHlsAudioInput(session);
    const first = input.begin();
    const second = input.begin();
    expect(input.push(first, 'old', audioPacket(), 0)).toBe(false);
    expect(input.push(second, 'new', audioPacket(), 0)).toBe(true);
    expect(input.push(second, 'new', audioPacket(), 0)).toBe(true);
    expect(session.onSourceChange).toHaveBeenCalledTimes(2);
    expect(session.fail).not.toHaveBeenCalled();
  });
  it('reuses the PSI-verified PID when later TS segments omit PAT and PMT', () => {
    const session = { push: vi.fn(), fail: vi.fn(), onSourceChange: vi.fn() };
    const input = new ExperimentalHlsAudioInput(session);
    const generation = input.begin();
    vi.mocked(discoverEc3Pid).mockReturnValueOnce(256).mockReturnValueOnce(null);
    expect(input.push(generation, 'first', audioPacket(), 0)).toBe(true);
    expect(input.push(generation, 'second', audioPacket(), 0)).toBe(true);
    expect(session.fail).not.toHaveBeenCalled();
  });
  it('fails closed when the media origin changes', () => {
    const session = { push: vi.fn(), fail: vi.fn(), onSourceChange: vi.fn() };
    const input = new ExperimentalHlsAudioInput(session);
    const generation = input.begin();
    expect(input.push(generation, 'a', audioPacket(), 0)).toBe(true);
    expect(input.push(generation, 'b', audioPacket(), 1)).toBe(false);
    expect(session.fail).toHaveBeenCalledTimes(1);
  });
});
