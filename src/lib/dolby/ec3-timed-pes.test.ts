import { describe, expect, it } from 'vitest';
import { timedEc3PesFrames } from './ec3-timed-pes';

const frame = Uint8Array.of(0x0b, 0x77, 0, 3, 0x34, 0x80, 0, 0);
describe('strict timed EC-3 PES input', () => {
  it('maps consecutive complete frames to the media sample clock', () => {
    const frames = timedEc3PesFrames({ bytes: Uint8Array.from([...frame, ...frame]), pts90k: 180000 }, 90000);
    expect(frames.map(f => f.ptsSamples)).toEqual([48000n, 49536n]);
    expect(frames[0].bytes).toEqual(frame);
  });
  it('rejects missing timestamps, partial frames, junk and ambiguous sample clocks', () => {
    for (const pes of [
      { bytes: frame, pts90k: null },
      { bytes: frame.slice(0, 7), pts90k: 90000 },
      { bytes: Uint8Array.from([0, ...frame]), pts90k: 90000 },
      { bytes: frame, pts90k: 90001 },
    ]) expect(() => timedEc3PesFrames(pes, 90000)).toThrow();
  });
  it('rejects dependent substreams', () => {
    const dependent = frame.slice(); dependent[2] = 0x40;
    expect(() => timedEc3PesFrames({ bytes: dependent, pts90k: 90000 }, 90000)).toThrow();
  });
});
