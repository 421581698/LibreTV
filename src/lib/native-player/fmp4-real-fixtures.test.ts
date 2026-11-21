import { describe, expect, it } from 'vitest';
import { extractFmp4SamplePayload, parseFmp4Fragments, parseFmp4InitSegment } from './fmp4-fragment-parser';

/**
 * Tiny real fragmented WebVTT fixture copied from mux.js test/segments:
 * https://github.com/videojs/mux.js/tree/main/test/segments
 * Upstream project license: Apache-2.0 (see videojs/mux.js LICENSE).
 */
const INIT_SEGMENT_BASE64 = `
AAAAGGZ0eXBjbWZjAAAAAGRhc2hpc282AAACGG1vb3YAAABsbXZoZAAAAAAA
AAAAAAAAAAABX5AAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAA
AAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAIAAAAobXZleAAAACB0cmV4AAAAAAAAAAEAAAABAAAAAAAAAAAAAAAA
AAABfHRyYWsAAABcdGtoZAAAAAcAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAA
AAAAAAAAAAAAAAAAARhtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAAPoAAAA
AFXEAAAAAAAzaGRscgAAAAAAAAAAdGV4dAAAAAAAAAAAAAAAAG1wNGZmIHRl
eHQgaGFuZGxlcgAAAAALZWxuZ2VuAAAAALJtaW5mAAAADG5taGQAAAAAAAAA
JGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAAenN0YmwAAAAu
c3RzZAAAAAAAAAABAAAAHnd2dHQAAAAAAAAAAAAAAA52dHRDV0VCVlRUAAAA
EHN0dHMAAAAAAAAAAAAAABBzdHNjAAAAAAAAAAAAAAAUc3RzegAAAAAAAAAA
AAAAAAAAABBzdGNvAAAAAAAAAAA=
`;

const MEDIA_SEGMENT_BASE64 = `
AAAAGHN0eXBjbWZzAAAAAGRhc2htc2RoAAAAmG1vb2YAAAAQbWZoZAAAAAAz
dkLpAAAAgHRyYWYAAAAQdGZoZAACAAAAAAABAAAAFHRmZHQBAAAAAAABkgvq
vFAAAABUdHJ1bgEADwEAAAAEAAAAoAAAA4QAAAAzAgAAAAAAAAAAAABkAAAA
CAIAAAAAAAAAAAADhAAAADMCAAAAAAAAAAAAAGQAAAAIAgAAAAAAAAAAAAB+
bWRhdAAAADN2dHRjAAAAK3BheWwyMDI0LTA5LTE5VDIwOjEzOjA2WgplbiAj
IDg2MzM4ODM5MwAAAAh2dHRlAAAAM3Z0dGMAAAArcGF5bDIwMjQtMDktMTlU
MjA6MTM6MDdaCmVuICMgODYzMzg4MzkzAAAACHZ0dGU=
`;

function fixture(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64.replace(/\s/g, ''), 'base64'));
}

describe('real fragmented WebVTT fixture', () => {
  it('parses an upstream init segment and its media fragment', () => {
    const initBytes = fixture(INIT_SEGMENT_BASE64);
    const mediaBytes = fixture(MEDIA_SEGMENT_BASE64);
    const init = parseFmp4InitSegment(initBytes);
    const fragments = parseFmp4Fragments(mediaBytes, { initSegment: init });

    expect(init.tracks).toHaveLength(1);
    expect(init.tracks[0]).toMatchObject({ trackId: 1, handlerType: 'text', timescale: 1000 });
    expect(fragments).toHaveLength(1);
    expect(fragments[0].tracks[0].trackId).toBe(1);
    expect(fragments[0].tracks[0].timescale).toBe(1000);
    expect(fragments[0].tracks[0].samples.length).toBeGreaterThan(0);
  });

  it('extracts a sample payload from the real mdat byte range when the offset is declared', () => {
    const mediaBytes = fixture(MEDIA_SEGMENT_BASE64);
    const init = parseFmp4InitSegment(fixture(INIT_SEGMENT_BASE64));
    const [fragment] = parseFmp4Fragments(mediaBytes, { initSegment: init });
    const sample = fragment.tracks[0].samples.find(candidate => candidate.dataOffset !== null && candidate.size !== null);
    expect(sample).toBeDefined();
    const payload = extractFmp4SamplePayload(mediaBytes, sample!);
    expect(payload.byteLength).toBe(sample!.size);
    expect(payload.byteLength).toBeGreaterThan(0);
  });
});
