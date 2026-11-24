import { describe, expect, it } from 'vitest';
import { inspectHlsDolbyVisionFormat } from './hls-level-inspector';

describe('inspectHlsDolbyVisionFormat', () => {
  it('reads Dolby Vision from the original CODECS attribute', () => {
    const report = inspectHlsDolbyVisionFormat('https://media.example/master.m3u8', [
      { videoCodec: 'hvc1.2.4.L153.B0', attrs: { CODECS: 'avc1.640028,dvh1.08.06' } },
    ]);
    expect(report).toMatchObject({ detected: true, profiles: [8], codecFamilies: ['hevc'] });
  });

  it('reads supplemental Dolby Vision codec signaling', () => {
    const report = inspectHlsDolbyVisionFormat('https://media.example/master.m3u8', [
      { videoCodec: 'hvc1.2.4.L153.B0', attrs: { 'SUPPLEMENTAL-CODECS': 'dvh1.08.06/hev1.2.4.L153.B0' } },
    ]);
    expect(report).toMatchObject({
      detected: true,
      profiles: [8],
      declarations: [{ codec: 'dvh1', source: 'supplemental-codecs' }],
    });
  });

  it('retains normalized videoCodec as a fallback', () => {
    const report = inspectHlsDolbyVisionFormat('https://media.example/master.m3u8', [
      { videoCodec: 'dvh1.08.06' },
    ]);
    expect(report).toMatchObject({ detected: true, profiles: [8] });
  });

  it('does not infer Dolby Vision from unrelated or malformed attributes', () => {
    const report = inspectHlsDolbyVisionFormat('https://media.example/master.m3u8', [
      { videoCodec: 'hvc1.2.4.L153.B0', attrs: { CODECS: 'hvc1.2.4.L153.B0', 'SUPPLEMENTAL-CODECS': 'not-dv/metadata' } },
    ]);
    expect(report.detected).toBe(false);
  });
});
