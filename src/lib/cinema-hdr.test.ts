import { describe, expect, it } from 'vitest';
import { assessCinemaHdr, inspectCinemaHdrVariants, isSafariNativeHdrCandidate } from './cinema-hdr';

const safari = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/604.1';
const defaults = {
  nativeHlsSupport: 'maybe', userAgent: safari,
  canPlayVideoCodec: (_codec: string) => 'maybe', matchMedia: (query: string) => ({ matches: query.includes('high') || query.includes('p3') }),
  qualityPreference: 'auto', playbackStarted: false, alreadyAttemptedNative: false,
};
describe('Cinema HDR V5 capability contract', () => {
  it('identifies PQ, HLG, Dolby Vision and SDR variants without confusing them', () => {
    const v = inspectCinemaHdrVariants([], [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,VIDEO-RANGE=PQ,CODECS="hvc1.2.4.L153.B0"',
      'pq.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,VIDEO-RANGE=HLG,CODECS="hvc1.2.4.L153.B0"',
      'hlg.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,VIDEO-RANGE=PQ,CODECS="hvc1.2.4.L153.B0",SUPPLEMENTAL-CODECS="dvh1.08.06/hvc1.2.4.L153.B0"',
      'dv.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,VIDEO-RANGE=SDR,CODECS="avc1.4d401f"',
      'sdr.m3u8',
    ].join('\n'));
    expect(v.map(x => x.format)).toEqual(['hdr10-candidate','hlg','dolby-vision','sdr']);
    expect(v[0].declaredBitDepth).toBe(10);
    expect(v.every(x => x.hdr10Plus === 'unverified')).toBe(true);
    expect(v.every(x => x.colorGamut === 'unknown')).toBe(true);
  });
  it('recognizes explicitly signaled AV1 CICP BT.2020/PQ and Display-P3/HLG', () => {
    const variants = inspectCinemaHdrVariants([
      { videoCodec: 'av01.0.08M.10.0.110.09.16.09.0' },
      { videoCodec: 'av01.0.08M.10.0.110.12.18.09.0' },
    ]);
    expect(variants.map(v => [v.transfer, v.colorGamut, v.declaredBitDepth])).toEqual([
      ['pq','bt2020',10],
      ['hlg','p3',10],
    ]);
    expect(variants.every(v => v.dynamicMetadataOutput === 'unverified')).toBe(true);
  });
  it('does not guess HDR based on HEVC codec without VIDEO-RANGE', () => {
    const v = inspectCinemaHdrVariants([{videoCodec:'hvc1.2.4.L153.B0'}]);
    expect(v[0].format).toBe('unknown');
    expect(v[0].transfer).toBe('unknown');
  });
  it('parses 10 and 12 bit AV1 codec signaling without claiming actual output depth', () => {
    expect(inspectCinemaHdrVariants([{ attrs:{CODECS:'av01.0.08M.10', 'VIDEO-RANGE':'PQ'} }])[0].declaredBitDepth).toBe(10);
    expect(inspectCinemaHdrVariants([{ attrs:{CODECS:'av01.0.08M.12', 'VIDEO-RANGE':'HLG'} }])[0].declaredBitDepth).toBe(12);
    const report = assessCinemaHdr(inspectCinemaHdrVariants([{attrs:{CODECS:'av01.0.08M.10','VIDEO-RANGE':'PQ'}}]), defaults);
    expect(report.actualBitDepth).toBe('unverified');
    expect(report.actualHdrOutput).toBe('unverified');
  });
  it('routes only supported declared PQ/HLG to native Safari and respects playback/quality restrictions', () => {
    const pq = inspectCinemaHdrVariants([{attrs:{CODECS:'hvc1.2.4.L153.B0','VIDEO-RANGE':'PQ'}}]);
    expect(isSafariNativeHdrCandidate(pq, defaults)).toBe(true);
    expect(isSafariNativeHdrCandidate(pq, {...defaults, canPlayVideoCodec: () => ''})).toBe(false);
    expect(isSafariNativeHdrCandidate(pq, {...defaults, qualityPreference: '1080'})).toBe(false);
    expect(isSafariNativeHdrCandidate(pq, {...defaults, playbackStarted: true})).toBe(false);
    expect(isSafariNativeHdrCandidate(pq, {...defaults, alreadyAttemptedNative: true})).toBe(false);
    expect(isSafariNativeHdrCandidate(pq, {...defaults, userAgent: 'AppleWebKit/605 Safari/604 CriOS/1'})).toBe(false);
    expect(isSafariNativeHdrCandidate(inspectCinemaHdrVariants([{attrs:{CODECS:'hvc1.2','VIDEO-RANGE':'SDR'}}]), defaults)).toBe(false);
  });
  it('treats missing browser hints and GPU attempts conservatively', () => {
    const v = inspectCinemaHdrVariants([{attrs:{CODECS:'avc1.4d401f','VIDEO-RANGE':'SDR'}}]);
    const report = assessCinemaHdr(v, {...defaults, matchMedia: () => { throw new Error('unavailable'); }}, true);
    expect(report.selectedOutput).toBe('gpu-sdr-enhancement');
    expect(report.displayHdrHint).toBe('unknown');
    expect(report.displayGamutHint).toBe('unknown');
    expect(report.actualHdrOutput).toBe('unverified');
  });
});
