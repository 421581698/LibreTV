import { describe, expect, it } from 'vitest';
import { JocCmafPacketExtractor, mapJocPresentationTimeToMediaSamples } from './joc-cmaf-packets';
import { validateCmafEac3AccessUnit } from './joc-cmaf-validation';
import { parseEc3SpecificBox } from './joc-dec3-config';

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
function makeDec3Box(dependent = 0, chanLoc = 0, bsid = 16): Uint8Array {
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let shift = width - 1; shift >= 0; shift -= 1) bits.push((value >> shift) & 1);
  };
  push(768, 13);
  push(0, 3);
  push(0, 2);
  push(bsid, 5);
  push(0, 1);
  push(0, 1);
  push(0, 3);
  push(7, 3);
  push(0, 1);
  push(0, 3);
  push(dependent, 4);
  if (dependent > 0) push(chanLoc, 9);
  else push(0, 1);
  push(0, 7);
  push(1, 1);
  push(8, 8);
  const payload = new Uint8Array(bits.length / 8);
  bits.forEach((bit, index) => { payload[index >> 3] |= bit << (7 - (index & 7)); });
  return box('dec3', payload);
}
function makeInitSegment(handler = 'soun', sampleEntry = 'ec-3', dec3 = makeDec3Box(), secondEc3 = false): Uint8Array {
  const tkhd = box('tkhd', join(u32(0), u32(0), u32(0), u32(7), u32(0)));
  const mdhd = box('mdhd', join(u32(0), u32(0), u32(0), u32(48_000), u32(0)));
  const hdlr = box('hdlr', join(u32(0), u32(0), new Uint8Array([...handler].map(char => char.charCodeAt(0))), new Uint8Array(12)));
  const audioEntry = new Uint8Array(28);
  audioEntry.set(u32(48_000 * 65_536), 24);
  const sampleEntryBox = sampleEntry === 'ec-3'
    ? box(sampleEntry, join(audioEntry, dec3))
    : box(sampleEntry, new Uint8Array(4));
  const entries = secondEc3
    ? join(sampleEntryBox, box('ec-3', join(audioEntry, makeDec3Box())))
    : sampleEntryBox;
  const stsd = box('stsd', join(u32(0), u32(secondEc3 ? 2 : 1), entries));
  const stbl = box('stbl', stsd);
  const minf = box('minf', stbl);
  const mdia = box('mdia', join(mdhd, hdlr, minf));
  const trak = box('trak', join(tkhd, mdia));
  const trex = box('trex', join(u32(0), u32(7), u32(1), u32(1536), u32(8), u32(0)));
  return box('moov', join(trak, box('mvex', trex)));
}
function eac3Frame(streamType = 0, substreamId = 0, blocksCode = 3, bsid = 16): number[] {
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let shift = width - 1; shift >= 0; shift -= 1) bits.push((value >> shift) & 1);
  };
  push(0x0b77, 16);
  push(streamType, 2);
  push(substreamId, 3);
  push(4, 11); // 10-byte syncframe
  push(0, 2); // 48 kHz
  push(blocksCode, 2);
  push(7, 3); // acmod
  push(0, 1); // lfeon
  push(bsid, 5);
  push(31, 5); // dialnorm
  push(0, 1); // compre
  if (streamType === 1) {
    push(1, 1); // chanmape
    push(0x0200, 16); // upstream Lrs/Rrs map -> dec3 chan_loc 0x002
  }
  push(0, 1); // mixmdate
  push(0, 1); // infomdate
  push(0, 1); // addbsie
  while (bits.length < 80) bits.push(0);
  const bytes = new Uint8Array(10);
  bits.forEach((bit, index) => { bytes[index >> 3] |= bit << (7 - (index & 7)); });
  return [...bytes];
}
function makeMediaSegment(
  samples: number[][] = [eac3Frame(), eac3Frame()],
  sampleDescriptionIndex?: number,
): Uint8Array {
  const sampleBytes = samples[0]?.length ?? 0;
  if (sampleBytes === 0 || samples.some(sample => sample.length !== sampleBytes)) {
    throw new Error('CMAF test samples must have one consistent non-zero size.');
  }
  const payload = join(...samples.map(sample => new Uint8Array(sample)));
  const tfhdFlags = 0x00020000 | 0x000008 | 0x000010 | 0x000020 |
    (sampleDescriptionIndex === undefined ? 0 : 0x000002);
  const tfhdFields = [u32(tfhdFlags), u32(7)];
  if (sampleDescriptionIndex !== undefined) tfhdFields.push(u32(sampleDescriptionIndex));
  tfhdFields.push(u32(1536), u32(sampleBytes), u32(0));
  const tfhd = box('tfhd', join(...tfhdFields));
  const tfdt = box('tfdt', join(u32(0x01000000), u32(0), u32(0)));
  const makeTrun = (offset: number) => box('trun', join(
    u32(0x000001 | 0x000100 | 0x000200),
    u32(samples.length),
    u32(offset),
    ...samples.map(sample => join(u32(1536), u32(sample.length))),
  ));
  const makeMoof = (offset: number) => box('moof', box('traf', join(tfhd, tfdt, makeTrun(offset))));
  const first = makeMoof(0);
  const moof = makeMoof(first.length + 8);
  return join(moof, box('mdat', payload));
}

describe('JocCmafPacketExtractor', () => {
  it('maps CMAF PTS deltas onto the anchored hls.js media clock', () => {
    expect(mapJocPresentationTimeToMediaSamples(240_000, 48_000, 12.5, 240_000)).toBe(600_000);
    expect(mapJocPresentationTimeToMediaSamples(241_536, 48_000, 12.5, 240_000)).toBe(601_536);
    expect(mapJocPresentationTimeToMediaSamples(483_072, 96_000, 12.5, 480_000)).toBe(601_536);
  });


  it('accepts one complete CMAF I0 access unit with optional dependent D0', () => {
    expect(validateCmafEac3AccessUnit(
      new Uint8Array(eac3Frame()), parseEc3SpecificBox(makeDec3Box()),
    )).toEqual({
      syncframes: 1, hasDependentD0: false, independentBsid: 16,
    });
    const dependentConfig = parseEc3SpecificBox(makeDec3Box(1, 0x002, 8));
    const dependentSample = new Uint8Array([...eac3Frame(0, 0, 3, 8), ...eac3Frame(1)]);
    expect(validateCmafEac3AccessUnit(dependentSample, dependentConfig)).toEqual({
      syncframes: 2, hasDependentD0: true, independentBsid: 8,
    });
    expect(() => validateCmafEac3AccessUnit(
      dependentSample, parseEc3SpecificBox(makeDec3Box(1, 0x001, 8)),
    )).toThrow(/chanmap disagrees/i);
  });

  it('rejects invalid CMAF substream order, IDs, profiles and truncated frames', () => {
    expect(() => validateCmafEac3AccessUnit(new Uint8Array(eac3Frame(1)))).toThrow(/begin with independent/i);
    expect(() => validateCmafEac3AccessUnit(new Uint8Array([...eac3Frame(), ...eac3Frame(1, 1)]))).toThrow(/D0/i);
    expect(() => validateCmafEac3AccessUnit(new Uint8Array([...eac3Frame(), ...eac3Frame(0)]))).toThrow(/D0/i);
    expect(() => validateCmafEac3AccessUnit(new Uint8Array(eac3Frame(0, 0, 2)))).toThrow(/six audio blocks/i);
    expect(() => validateCmafEac3AccessUnit(new Uint8Array(eac3Frame()).subarray(0, 6))).toThrow(/truncated/i);
    expect(() => validateCmafEac3AccessUnit(new Uint8Array([...eac3Frame(), ...eac3Frame(1), ...eac3Frame(1)]))).toThrow(/only I0 and optional D0/i);
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
    expect([...result.packets[0].bytes]).toEqual(eac3Frame());
    expect([...result.packets[1].bytes]).toEqual(eac3Frame());
  });

  it('extracts an I0+D0 CMAF sample and enforces its dec3 channel map', () => {
    const accessUnit = [...eac3Frame(0, 0, 3, 8), ...eac3Frame(1)];
    const extractor = new JocCmafPacketExtractor(7);
    extractor.updateInitSegment(makeInitSegment('soun', 'ec-3', makeDec3Box(1, 0x002, 8)));
    const result = extractor.extractMediaSegment(makeMediaSegment([accessUnit]));
    expect(result.packets).toHaveLength(1);
    expect([...result.packets[0].bytes]).toEqual(accessUnit);

    const mismatched = new JocCmafPacketExtractor(7);
    mismatched.updateInitSegment(makeInitSegment('soun', 'ec-3', makeDec3Box(1, 0x001, 8)));
    expect(() => mismatched.extractMediaSegment(makeMediaSegment([accessUnit]))).toThrow(/chanmap disagrees/i);
  });

  it('rejects a selected track that is not an E-AC-3 audio track', () => {
    const extractor = new JocCmafPacketExtractor(7);
    expect(() => extractor.updateInitSegment(makeInitSegment('vide', 'ec-3'))).toThrow(/not an E-AC-3 audio track/i);
    expect(() => extractor.updateInitSegment(makeInitSegment('soun', 'mp4a'))).toThrow(/not an E-AC-3 audio track/i);
  });

  it('rejects sample-description changes without a replacement init segment', () => {
    const extractor = new JocCmafPacketExtractor(7);
    extractor.updateInitSegment(makeInitSegment('soun', 'ec-3', makeDec3Box(), true));
    expect(() => extractor.extractMediaSegment(makeMediaSegment([eac3Frame()], 2)))
      .toThrow(/sample description index changed/i);
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
