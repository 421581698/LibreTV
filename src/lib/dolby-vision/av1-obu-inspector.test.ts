import { describe, expect, it } from 'vitest';
import { inspectAv1ObuStream } from './av1-obu-inspector';

function obu(type: number, payload: number[], extension = false): Uint8Array {
  const header = (type << 3) | 0x02 | (extension ? 0x04 : 0);
  return new Uint8Array([header, ...(extension ? [0] : []), payload.length, ...payload]);
}

describe('inspectAv1ObuStream', () => {
  it('counts metadata and T.35 metadata OBUs without claiming Dolby Vision RPU', () => {
    const stream = obu(2, []).reduce((a, b) => [...a, b], [] as number[])
      .concat([...obu(5, [4, 0x00, 0x01])]);
    const result = inspectAv1ObuStream(new Uint8Array(stream));
    expect(result).toMatchObject({ valid: true, obuCount: 2, metadataObuCount: 1, ituT35MetadataObuCount: 1, rpuPresence: 'unknown' });
  });

  it('rejects a truncated OBU payload', () => {
    expect(inspectAv1ObuStream(new Uint8Array([0x2a, 0x05, 0x01]))).toMatchObject({ valid: false, errors: ['OBU payload is truncated.'] });
  });

  it('rejects an OBU without a size field', () => {
    expect(inspectAv1ObuStream(new Uint8Array([0x28, 0x00]))).toMatchObject({ valid: false });
  });

  it('rejects overlong size LEB128', () => {
    expect(inspectAv1ObuStream(new Uint8Array([0x2a, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00]))).toMatchObject({ valid: false });
  });

  it('enforces the configured payload limit before advancing', () => {
    expect(inspectAv1ObuStream(new Uint8Array([0x2a, 0x04, 1, 2, 3, 4]), { maxObuPayloadBytes: 3 })).toMatchObject({ valid: false });
  });

  it('rejects invalid reserved header bits', () => {
    expect(inspectAv1ObuStream(new Uint8Array([0x2b, 0x00]))).toMatchObject({ valid: false });
  });

  it('rejects truncated extension headers', () => {
    expect(inspectAv1ObuStream(new Uint8Array([0x2e]))).toMatchObject({ valid: false });
  });

  it('rejects malformed metadata type', () => {
    expect(inspectAv1ObuStream(new Uint8Array([0x2a, 0x01, 0x80]))).toMatchObject({ valid: false });
  });
});
