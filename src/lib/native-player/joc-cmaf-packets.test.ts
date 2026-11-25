import { describe, expect, it } from 'vitest';
import { JocCmafPacketExtractor, mapJocPresentationTimeToMediaSamples } from './joc-cmaf-packets';

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}
function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function box(type: string, payload: Uint8Array): Uint8Array {
  return join(u32(payload.length + 8), new Uint8Array([...type].map(char => char.charCodeAt(0))), payload);
}
function makeInitSegment(handler = 'soun', sampleEntry = 'ec-3'): Uint8Array {
  const tkhd = box('tkhd', join(u32(0), u32(0), u32(0), u32(7), u32(0)));
  const mdhd = box('mdhd', join(u32(0), u32(0), u32(0), u32(48_000), u32(0)));
  const hdlr = box('hdlr', join(u32(0), u32(0), new Uint8Array([...handler].map(char => char.charCodeAt(0))), new Uint8Array(12)));
  const stsd = box('stsd', join(u32(0), u32(1), box(sampleEntry, new Uint8Array(4))));
  const stbl = box('stbl', stsd);
  const minf = box('minf', stbl);
  const mdia = box('mdia', join(mdhd, hdlr, minf));
  const trak = box('trak', join(tkhd, mdia));
  const trex = box('trex', join(u32(0), u32(7), u32(1), u32(1536), u32(4), u32(0)));
  return box('moov', join(trak, box('mvex', trex)));
}
function makeMediaSegment(payload = [1, 2, 3, 4, 5, 6, 7, 8]): Uint8Array {
  const tfhd = box('tfhd', join(u32(0x00020000 | 0x000008 | 0x000010 | 0x000020), u32(7), u32(1536), u32(4), u32(0)));
  const tfdt = box('tfdt', join(u32(0x01000000), u32(0), u32(0)));
  const makeTrun = (offset: number) => box('trun', join(
    u32(0x000001 | 0x000100 | 0x000200),
    u32(payload.length / 4),
    u32(offset),
    ...Array.from({ length: payload.length / 4 }, () => join(u32(1536), u32(4))),
  ));
  const makeMoof = (offset: number) => box('moof', box('traf', join(tfhd, tfdt, makeTrun(offset))));
  const first = makeMoof(0);
  const moof = makeMoof(first.length + 8);
  return join(moof, box('mdat', new Uint8Array(payload)));
}

describe('JocCmafPacketExtractor', () => {
  it('maps CMAF PTS deltas onto the anchored hls.js media clock', () => {
    expect(mapJocPresentationTimeToMediaSamples(240_000, 48_000, 12.5, 240_000)).toBe(600_000);
    expect(mapJocPresentationTimeToMediaSamples(241_536, 48_000, 12.5, 240_000)).toBe(601_536);
    expect(mapJocPresentationTimeToMediaSamples(483_072, 96_000, 12.5, 480_000)).toBe(601_536);
  });

  it('rejects invalid CMAF-to-media timeline anchors', () => {
    expect(() => mapJocPresentationTimeToMediaSamples(1, 0, 1, 0)).toThrow(/positive timescale/i);
    expect(() => mapJocPresentationTimeToMediaSamples(Number.NaN, 48_000, 1, 0)).toThrow(/finite timestamps/i);
  });

  it('extracts bounded E-AC-3 samples with timestamps without claiming JOC', () => {
    const extractor = new JocCmafPacketExtractor(7);
    extractor.updateInitSegment(makeInitSegment());
    const result = extractor.extractMediaSegment(makeMediaSegment());
    expect(result.codecHint).toBe('ec-3');
    expect(result.trackId).toBe(7);
    expect(result.timescale).toBe(48_000);
    expect(result.packets).toHaveLength(2);
    expect(result.packets[0]).toMatchObject({ decodeTime: 0, presentationTime: 0, duration: 1536, timescale: 48_000 });
    expect([...result.packets[0].bytes]).toEqual([1, 2, 3, 4]);
    expect([...result.packets[1].bytes]).toEqual([5, 6, 7, 8]);
  });

  it('rejects a selected track that is not an E-AC-3 audio track', () => {
    const extractor = new JocCmafPacketExtractor(7);
    expect(() => extractor.updateInitSegment(makeInitSegment('vide', 'ec-3'))).toThrow(/not an E-AC-3 audio track/i);
    expect(() => extractor.updateInitSegment(makeInitSegment('soun', 'mp4a'))).toThrow(/not an E-AC-3 audio track/i);
  });

  it('requires an initialization segment before media fragments', () => {
    const extractor = new JocCmafPacketExtractor(7);
    expect(() => extractor.extractMediaSegment(makeMediaSegment())).toThrow(/initialization segment/i);
  });

  it('enforces per-sample and per-segment payload bounds', () => {
    const init = makeInitSegment();
    const extractor = new JocCmafPacketExtractor(7, { maxSampleBytes: 3 });
    extractor.updateInitSegment(init);
    expect(() => extractor.extractMediaSegment(makeMediaSegment())).toThrow(/sample exceeds/i);

    const segmentBounded = new JocCmafPacketExtractor(7, { maxSegmentPayloadBytes: 7 });
    segmentBounded.updateInitSegment(init);
    expect(() => segmentBounded.extractMediaSegment(makeMediaSegment())).toThrow(/segment exceeds/i);
  });

  it('rejects invalid track IDs and limits', () => {
    expect(() => new JocCmafPacketExtractor(0)).toThrow(/track ID/i);
    expect(() => new JocCmafPacketExtractor(7, { maxSamplesPerSegment: 0 })).toThrow(/limits/i);
  });
});
