import { describe, expect, it } from 'vitest';
import { extractFmp4SamplePayload, parseFmp4Fragments, parseFmp4InitSegment } from './fmp4-fragment-parser';

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

function makeFragment(dataOffsetOverride?: number, omitTfhdDefaults = false, mdatSize = 8): Uint8Array {
  const tfhd = box('tfhd', omitTfhdDefaults
    ? join(u32(0x00020000), u32(7))
    : join(u32(0x00020000 | 0x000008 | 0x000010 | 0x000020), u32(7), u32(1000), u32(4), u32(0)));

  const tfdt = box('tfdt', join(u32(0x01000000), u32(0), u32(5000)));
  const makeTrun = (dataOffset: number) => box('trun', join(
    u32(0x01000000 | 0x000001 | 0x000800),
    u32(2), i32(dataOffset), i32(0), i32(-120),
  ));
  const makeMoof = (dataOffset: number) => box('moof', box('traf', join(tfhd, tfdt, makeTrun(dataOffset))));
  const first = makeMoof(0);
  const moof = makeMoof(dataOffsetOverride ?? first.length + 8);
  const mdatPayload = new Uint8Array(mdatSize);
  mdatPayload.set([1, 2, 3, 4, 5, 6, 7, 8].slice(0, mdatSize));
  return join(moof, box('mdat', mdatPayload));
}

function makeMultiTrafFragment(): Uint8Array {
  const makeTraf = (trackId: number, dataOffset: number) => {
    const tfhd = box('tfhd', join(u32(0x000008 | 0x000010 | 0x000020), u32(trackId), u32(1000), u32(4), u32(0)));
    const tfdt = box('tfdt', join(u32(0), u32(trackId * 1000)));
    const trun = box('trun', join(u32(0x000001), u32(1), i32(dataOffset)));
    return box('traf', join(tfhd, tfdt, trun));
  };
  const makeMoof = (firstOffset: number, secondOffset: number) =>
    box('moof', join(makeTraf(7, firstOffset), makeTraf(8, secondOffset)));
  const first = makeMoof(0, 0);
  const moof = makeMoof(first.length + 8, 0);
  return join(moof, box('mdat', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
}

function makeDescriptionIndexFragment(descriptionIndex: number): Uint8Array {
  const tfhd = box('tfhd', join(u32(0x020000 | 0x000002), u32(7), u32(descriptionIndex)));
  const tfdt = box('tfdt', join(u32(0), u32(5000)));
  const trun = box('trun', join(u32(0), u32(1)));
  const traf = box('traf', join(tfhd, tfdt, trun));
  return join(box('moof', traf), box('mdat', new Uint8Array([1, 2, 3, 4])));
}

function makeInitSegment(defaultDescriptionIndex = 1): Uint8Array {
  const tkhd = box('tkhd', join(u32(0), u32(0), u32(0), u32(7), u32(0)));
  const mdhd = box('mdhd', join(u32(0), u32(0), u32(0), u32(90_000), u32(0)));
  const hdlr = box('hdlr', join(
    u32(0), u32(0),
    new Uint8Array([118, 105, 100, 101]),
    new Uint8Array(12),
  ));
  const sampleEntries = join(
    box('avc1', new Uint8Array([0, 0, 0, 0])),
    box('hvc1', new Uint8Array([0, 0, 0, 0])),
  );
  const stsd = box('stsd', join(u32(0), u32(2), sampleEntries));
  const stbl = box('stbl', stsd);
  const minf = box('minf', stbl);
  const mdia = box('mdia', join(mdhd, hdlr, minf));
  const trak = box('trak', join(tkhd, mdia));
  const trex = box('trex', join(
    u32(0), u32(7), u32(defaultDescriptionIndex), u32(3000), u32(2048), u32(0x00010000),
  ));
  return box('moov', join(trak, box('mvex', trex)));
}

describe('parseFmp4InitSegment', () => {
  it('reads track timescale, handler, sample entry and trex defaults', () => {
    expect(parseFmp4InitSegment(makeInitSegment()).tracks).toEqual([{
      trackId: 7,
      timescale: 90_000,
      handlerType: 'vide',
      sampleEntry: 'avc1',
      sampleEntries: ['avc1', 'hvc1'],
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 3000,
      defaultSampleSize: 2048,
      defaultSampleFlags: 0x00010000,
    }]);
  });

  it('rejects initialization segments without a movie box', () => {
    expect(() => parseFmp4InitSegment(box('free', new Uint8Array()))).toThrow(/missing moov/i);
  });

  it('selects the sample entry referenced by trex rather than always choosing the first', () => {
    expect(parseFmp4InitSegment(makeInitSegment(2)).tracks[0].sampleEntry).toBe('hvc1');
  });
});

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

  it('extracts zero-copy sample payload views from mdat', () => {
    const bytes = makeFragment();
    const [fragment] = parseFmp4Fragments(bytes);
    const samples = fragment.tracks[0].samples;
    expect([...extractFmp4SamplePayload(bytes, samples[0])]).toEqual([1, 2, 3, 4]);
    expect([...extractFmp4SamplePayload(bytes, samples[1])]).toEqual([5, 6, 7, 8]);
    expect(extractFmp4SamplePayload(bytes, samples[0]).buffer).toBe(bytes.buffer);
  });

  it('rejects samples without a valid payload range', () => {
    expect(() => extractFmp4SamplePayload(new Uint8Array(8), { dataOffset: null, size: 4 })).toThrow(/not available/i);
    expect(() => extractFmp4SamplePayload(new Uint8Array(8), { dataOffset: 6, size: 4 })).toThrow(/outside/i);
  });

  it('can require sample payloads to be contained by a declared mdat range', () => {
    const bytes = makeFragment();
    const [fragment] = parseFmp4Fragments(bytes);
    const sample = fragment.tracks[0].samples[0];
    expect(extractFmp4SamplePayload(bytes, sample, fragment.mdatRanges).byteLength).toBe(4);
    expect(() => extractFmp4SamplePayload(bytes, { dataOffset: 8, size: 4 }, fragment.mdatRanges))
      .toThrow(/outside.*mdat/i);
  });

  it('filters by track id and accepts a view into a larger backing buffer', () => {
    const fragment = makeFragment();
    const padded = join(new Uint8Array([9, 9, 9]), fragment, new Uint8Array([8]));
    const parsed = parseFmp4Fragments(padded.subarray(3, 3 + fragment.length), { trackId: 8 });
    expect(parsed[0].tracks).toEqual([]);
  });

  it('uses tfhd sample_description_index overrides for the active init segment', () => {
    const initSegment = parseFmp4InitSegment(makeInitSegment());
    const [fragment] = parseFmp4Fragments(makeDescriptionIndexFragment(2), { initSegment });
    expect(fragment.tracks[0]).toMatchObject({ sampleDescriptionIndex: 2, sampleEntry: 'hvc1' });
  });

  it('rejects a tfhd sample description index absent from the active init segment', () => {
    const initSegment = parseFmp4InitSegment(makeInitSegment());
    expect(() => parseFmp4Fragments(makeDescriptionIndexFragment(3), { initSegment }))
      .toThrow(/missing sample description index/i);
  });

  it('uses trex defaults when tfhd does not override sample duration, size or flags', () => {
    const initSegment = parseFmp4InitSegment(makeInitSegment());
    const bytes = makeFragment(undefined, true, 4096);
    const [fragment] = parseFmp4Fragments(bytes, { initSegment });
    expect(fragment.tracks[0].timescale).toBe(90_000);
    expect(fragment.tracks[0].samples).toEqual([
      expect.objectContaining({ duration: 3000, size: 2048, flags: 0x00010000 }),
      expect.objectContaining({ duration: 3000, size: 2048, flags: 0x00010000 }),
    ]);
  });

  it('resolves implicit data base offsets across multiple traf boxes, including track filtering', () => {
    const bytes = makeMultiTrafFragment();
    const [fragment] = parseFmp4Fragments(bytes);
    expect(fragment.tracks.map(track => track.trackId)).toEqual([7, 8]);
    expect(fragment.tracks[0].samples[0].dataOffset).toBe(fragment.moofSize + 8);
    expect(fragment.tracks[1].samples[0].dataOffset).toBe(fragment.moofSize + 12);

    const filtered = parseFmp4Fragments(bytes, { trackId: 8 });
    expect(filtered[0].tracks).toHaveLength(1);
    expect(filtered[0].tracks[0].samples[0].dataOffset).toBe(fragment.moofSize + 12);
  });

  it('applies maxSamples across all traf boxes in the input segment', () => {
    expect(() => parseFmp4Fragments(makeMultiTrafFragment(), { maxSamples: 1 }))
      .toThrow(/sample count exceeds/i);
  });

  it('rejects truncated and invalid box lengths', () => {
    expect(() => parseFmp4Fragments(new Uint8Array([0, 0, 0, 4, 109, 111, 111, 102]))).toThrow(/box size/i);
    expect(() => parseFmp4Fragments(new Uint8Array([0, 0, 0]))).toThrow(/truncated/i);
  });

  it('enforces a bounded sample count', () => {
    expect(() => parseFmp4Fragments(makeFragment(), { maxSamples: 1 })).toThrow(/sample count/i);
  });
});
