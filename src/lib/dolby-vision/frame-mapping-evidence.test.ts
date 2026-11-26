import { describe, expect, it } from 'vitest';
import { digestRpuFrameMapping } from './frame-mapping-evidence';
const media = 'a'.repeat(64);
const timeBase = { numerator: 1, denominator: 90000 };
const frames = [
  { frameOrdinal: 0, pts: '-3003', rpuSha256: 'b'.repeat(64) },
  { frameOrdinal: 1, pts: '9007199254740993', rpuSha256: 'c'.repeat(64) },
];
describe('canonical RPU frame mapping evidence', () => {
  it('binds exact timestamps, media identity, timebase and RPU digest', () => {
    const digest = digestRpuFrameMapping(media, timeBase, frames);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digestRpuFrameMapping(media, timeBase, frames)).toBe(digest);
    expect(digestRpuFrameMapping('d'.repeat(64), timeBase, frames)).not.toBe(digest);
    expect(digestRpuFrameMapping(media, { ...timeBase, denominator: 48000 }, frames)).not.toBe(digest);
    expect(digestRpuFrameMapping(media, timeBase, [frames[0], { ...frames[1], rpuSha256: frames[0].rpuSha256 }])).not.toBe(digest);
  });
  it('rejects duplicate PTS, reordered frames and noncanonical timestamps', () => {
    for (const frame of [{ ...frames[1], pts: frames[0].pts }, { ...frames[1], frameOrdinal: 0 }, { ...frames[1], pts: '01' }]) {
      expect(() => digestRpuFrameMapping(media, timeBase, [frames[0], frame])).toThrow();
    }
  });
});
