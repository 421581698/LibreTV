import { describe, expect, it } from 'vitest';
import { inspectDolbyVisionFormat, parseHlsDolbyVisionDeclarations } from './format-inspector';

describe('inspectDolbyVisionFormat', () => {
  it('recognizes exact HEVC Dolby Vision codec declarations', () => {
    expect(inspectDolbyVisionFormat({
      url: 'https://cdn.example/movie.m3u8?token=1',
      codecs: 'avc1.640028,dvh1.08.06',
    })).toMatchObject({
      container: 'hls',
      detected: true,
      profiles: [8],
      levels: [6],
      codecFamilies: ['hevc'],
      confidence: 'declared',
    });
  });

  it('recognizes AV1 and AVC Dolby Vision codec identifiers without conflating families', () => {
    expect(inspectDolbyVisionFormat({ codecs: 'dav1.10.08' }).codecFamilies).toEqual(['av1']);
    expect(inspectDolbyVisionFormat({ codecs: 'dva1.09.06' }).codecFamilies).toEqual(['avc']);\n    expect(inspectDolbyVisionFormat({ codecs: 'dvav.09.04' })).toMatchObject({ profiles: [9], codecFamilies: ['avc'] });\n    expect(inspectDolbyVisionFormat({ codecs: 'dvhe.00.04' })).toMatchObject({ profiles: [0], detected: true });
  });

  it('parses quoted HLS CODECS and SUPPLEMENTAL-CODECS declarations', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.640028,dvhe.05.06",VIDEO-RANGE=PQ',
      'variant/1080p.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=8000000,SUPPLEMENTAL-CODECS="dvh1.08.06"',
      'variant/4k.m3u8',
    ].join('\n');
    const result = parseHlsDolbyVisionDeclarations(manifest);
    expect(result.map((item) => [item.codec, item.profile, item.level])).toEqual([
      ['dvhe', 5, 6],
      ['dvh1', 8, 6],
    ]);
    expect(inspectDolbyVisionFormat({ manifest })).toMatchObject({
      detected: true,
      profiles: [5, 8],
      videoRange: 'PQ',
    });
  });

  it('does not treat HDR10/PQ or HLG declarations as Dolby Vision', () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,VIDEO-RANGE=PQ,CODECS="hvc1.2.4.L153.B0"\nvideo.m3u8';
    expect(inspectDolbyVisionFormat({ manifest })).toMatchObject({
      detected: false,
      videoRange: 'PQ',
      confidence: 'unknown',
    });
  });

  it('rejects malformed codec prefixes, invalid zero values and trailing junk', () => {
    const malformed = [
      'xdvhe.08.06', 'dvhe.08.060', 'dvh1.08.00',
      'dvhe.8.06', 'dav1.10.08.extra', 'dvhe.xx.06', 'dvhe.21.06',
    ];
    for (const codecs of malformed) {
      expect(inspectDolbyVisionFormat({ codecs }).detected, codecs).toBe(false);
    }
  });

  it('does not infer container from URL query strings', () => {
    expect(inspectDolbyVisionFormat({ url: 'https://cdn.example/clip.mp4?next=.m3u8' }).container).toBe('mp4');
  });

  it('keeps unknown metadata unknown instead of claiming unsupported', () => {
    expect(inspectDolbyVisionFormat({}).confidence).toBe('unknown');
    expect(inspectDolbyVisionFormat({}).detected).toBe(false);
  });
});
