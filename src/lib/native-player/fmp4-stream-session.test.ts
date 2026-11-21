import { describe, expect, it } from 'vitest';
import { Fmp4StreamSession } from './fmp4-stream-session';

function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return join(u32(payload.length + 8), new Uint8Array([...type].map(char => char.charCodeAt(0))), payload);
}

function makeInitSegment(timescale = 90_000): Uint8Array {
  const tkhd = box('tkhd', join(u32(0), u32(0), u32(0), u32(7), u32(0)));
  const mdhd = box('mdhd', join(u32(0), u32(0), u32(0), u32(timescale), u32(0)));
  const hdlr = box('hdlr', join(u32(0), u32(0), new Uint8Array([118, 105, 100, 101]), new Uint8Array(12)));
  const stsd = box('stsd', join(u32(0), u32(1), box('avc1', new Uint8Array([0, 0, 0, 0]))));
  const stbl = box('stbl', stsd);
  const minf = box('minf', stbl);
  const mdia = box('mdia', join(mdhd, hdlr, minf));
  const trak = box('trak', join(tkhd, mdia));
  const trex = box('trex', join(u32(0), u32(7), u32(1), u32(3000), u32(4), u32(0)));
  return box('moov', join(trak, box('mvex', trex)));
}

function makeFragment(decodeTime: number): Uint8Array {
  const tfhd = box('tfhd', join(u32(0x020000), u32(7)));
  const tfdt = box('tfdt', join(u32(0), u32(decodeTime)));
  const trun = box('trun', join(u32(0), u32(1)));
  const traf = box('traf', join(tfhd, tfdt, trun));
  return join(box('moof', traf), box('mdat', new Uint8Array([1, 2, 3, 4])));
}

describe('Fmp4StreamSession', () => {
  it('binds media fragments to the active init metadata and preserves continuous timelines', () => {
    const session = new Fmp4StreamSession();
    expect(session.updateInitSegment(makeInitSegment()).changed).toBe(true);
    const first = session.parseMediaSegment(makeFragment(90_000));
    const second = session.parseMediaSegment(makeFragment(93_000));
    expect(first.fragments[0].tracks[0].timescale).toBe(90_000);
    expect(second.discontinuities).toEqual([]);
    expect(second.initGeneration).toBe(1);
  });

  it('detects gaps, overlaps and decode-time resets across segment boundaries', () => {
    const session = new Fmp4StreamSession();
    session.updateInitSegment(makeInitSegment());
    session.parseMediaSegment(makeFragment(90_000));
    const gap = session.parseMediaSegment(makeFragment(97_500)).discontinuities[0];
    expect(gap).toMatchObject({ trackId: 7, kind: 'gap' });
    expect(gap?.deltaSeconds).toBeCloseTo(0.05, 5);

    session.recover();
    session.parseMediaSegment(makeFragment(90_000));
    expect(session.parseMediaSegment(makeFragment(92_000)).discontinuities[0]?.kind).toBe('overlap');

    session.recover();
    session.parseMediaSegment(makeFragment(90_000));
    expect(session.parseMediaSegment(makeFragment(0)).discontinuities[0]?.kind).toBe('reset');
  });

  it('clears timeline baselines when the init segment changes', () => {
    const session = new Fmp4StreamSession();
    const first = session.updateInitSegment(makeInitSegment(90_000));
    session.parseMediaSegment(makeFragment(90_000));
    const second = session.updateInitSegment(makeInitSegment(48_000));
    expect(first.generation).toBe(1);
    expect(second).toMatchObject({ changed: true, generation: 2 });
    expect(session.parseMediaSegment(makeFragment(48_000)).discontinuities).toEqual([]);
  });

  it('resets continuity state after malformed fragments and reports recovery generation', () => {
    const session = new Fmp4StreamSession();
    session.updateInitSegment(makeInitSegment());
    session.parseMediaSegment(makeFragment(90_000));
    expect(() => session.parseMediaSegment(new Uint8Array([0, 0, 0]))).toThrow(/timeline baseline reset/i);
    const recovered = session.parseMediaSegment(makeFragment(0));
    expect(recovered.recoveryGeneration).toBe(1);
    expect(recovered.discontinuities).toEqual([]);
  });

  it('requires an init segment before parsing media fragments', () => {
    expect(() => new Fmp4StreamSession().parseMediaSegment(makeFragment(0))).toThrow(/init segment/i);
  });
});
