import { describe, expect, it } from 'vitest';
import { verifyHlsFramePresentationOrder } from './hls-frame-timeline';
const fragment = (pts: string[], denominator = 90000) => ({
  timeBase: { numerator: 1, denominator },
  frames: pts.map((pts, frameOrdinal) => ({ pts, frameOrdinal, rpuSha256: 'a'.repeat(64) })),
});
describe('HLS exact presentation order', () => {
  it('compares different timebases without floating point rounding', () => {
    expect(verifyHlsFramePresentationOrder([fragment(['0', '45000']), fragment(['48000'], 48000)])).toBe(true);
    expect(verifyHlsFramePresentationOrder([fragment(['9007199254740992']), fragment(['9007199254740993'])])).toBe(true);
  });
  it('rejects repeated or reversed presentation times and empty fragments', () => {
    expect(verifyHlsFramePresentationOrder([fragment(['45000']), fragment(['24000'], 48000)])).toBe(false);
    expect(verifyHlsFramePresentationOrder([fragment(['90000']), fragment(['0'])])).toBe(false);
    expect(verifyHlsFramePresentationOrder([fragment([])])).toBe(false);
  });
});
