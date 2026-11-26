import { describe, expect, it, vi } from 'vitest';
import { ExperimentalTsAudioInput } from './experimental-ts-audio-input';

function segment() {
  const packet = new Uint8Array(188).fill(0xff);
  packet.set([0x47, 0x41, 0, 0x10]);
  packet.set([0, 0, 1, 0xbd, 0, 16, 0x80, 0x80, 5, 0x21, 0, 1, 0, 1,
    0x0b, 0x77, 0, 3, 0x34, 0x80, 0, 0], 4);
  return packet;
}
describe('experimental clear TS audio input', () => {
  it('feeds complete timestamped EC-3 frames to the session', () => {
    const session = { push: vi.fn(() => true), fail: vi.fn() };
    const input = new ExperimentalTsAudioInput(256, 0, session);
    expect(input.pushSegment(segment())).toBe(true);
    expect(session.push).toHaveBeenCalledWith(Uint8Array.of(0x0b, 0x77, 0, 3, 0x34, 0x80, 0, 0), 0n);
    expect(session.fail).not.toHaveBeenCalled();
  });
  it('fails closed on malformed segments or rejected audio', () => {
    const session = { push: vi.fn(() => false), fail: vi.fn() };
    const input = new ExperimentalTsAudioInput(256, 0, session);
    expect(input.pushSegment(segment())).toBe(false);
    expect(input.pushSegment(segment())).toBe(false);
    expect(session.fail).toHaveBeenCalledTimes(1);
    const other = new ExperimentalTsAudioInput(256, 0, session);
    expect(other.pushSegment(new Uint8Array(187))).toBe(false);
  });
});
