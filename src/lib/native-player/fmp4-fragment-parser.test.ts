import { describe, expect, it } from 'vitest';
import { parseFmp4Fragments } from './fmp4-fragment-parser';

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function i32(value: number): Uint8Array { return u32(value >>> 0); }

function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return join(u32(payload.length + 8), new Uint8Array([...type].map(char => char.charCodeAt(0))), payload);
}

function makeFragment(dataOffsetOverride?: number): Uint8Array {
  const tfhd = box('tfhd', join(
    u32(0x00020000 | 0x000008 | 0x000010 | 0x000020),
    u32(7), u32(1000), u32(4), u32(0),
  ));
  const tfdt = box('tfdt', join(u32(0x01000000), u32(0), u32(5000)));
  const makeTrun = (dataOffset: number) => box('trun', join(
    u32(0x01000000 | 0x000001 | 0x000800),
    u32(2), i32(dataOffset), i32(0), i32(-120),
  ));
  const makeMoof = (dataOffset: number) => box('moof', box('traf', join(tfhd, tfdt, makeTrun(dataOffset))));
  const first = makeMoof(0);
  const moof = makeMoof(dataOffsetOverride ?? first.length + 8);
  return join(moof, box('mdat', new Uint8Array(8)));
}

describe('parseFmp4Fragments', () => {
  it('extracts per-sample decode and presentation timing plus byte ranges', () => {
    const bytes = makeFragment();
    const [fragment] = parseFmp4Fragments(bytes);
    expect(fragment.tracks).toHaveLength(1);
    expect(fragment.tracks[0].trackId).toBe(7);
    expect(fragment.tracks[0].baseDecodeTime).toBe(5000);
    expect(fragment.tracks[0].samples).toEqual([
      expect.objectContaining({
        index: 0, decodeTime: 5000, duration: 1000, compositionTimeOffset: 0,
        presentationTime: 5000, size: 4, dataOffset: fragment.moofSize + 8, isSync: true,
      }),
      expect.objectContaining({
        index: 1, decodeTime: 6000, duration: 1000, compositionTimeOffset: -120,
        presentationTime: 5880, size: 4, dataOffset: fragment.moofSize + 12, isSync: true,
      }),
    ]);
    expect(fragment.mdatRanges).toEqual([{ start: fragment.moofSize + 8, end: fragment.moofSize + 16 }]);
  });

  it('filters by track id and accepts a view into a larger backing buffer', () => {
    const fragment = makeFragment();
    const padded = join(new Uint8Array([9, 9, 9]), fragment, new Uint8Array([8]));
    const parsed = parseFmp4Fragments(padded.subarray(3, 3 + fragment.length), { trackId: 8 });
    expect(parsed[0].tracks).toEqual([]);
  });

  it('rejects truncated and invalid box lengths', () => {
    expect(() => parseFmp4Fragments(new Uint8Array([0, 0, 0, 4, 109, 111, 111, 102]))).toThrow(/box size/i);
    expect(() => parseFmp4Fragments(new Uint8Array([0, 0, 0]))).toThrow(/truncated/i);
  });

  it('enforces a bounded sample count', () => {
    expect(() => parseFmp4Fragments(makeFragment(), { maxSamples: 1 })).toThrow(/sample count/i);
  });
});
