import { describe, expect, it } from 'vitest';
import { inspectDolbyVisionFormat } from './format-inspector';
import { probeNativeDolbyVisionCapabilities } from './native-playback-capability';

describe('native Dolby Vision browser capability signals', () => {
  const report = inspectDolbyVisionFormat({
    url: 'https://example.test/master.m3u8',
    manifest: [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=10000000,CODECS="dvh1.05.06",VIDEO-RANGE=PQ',
      'dv.m3u8',
    ].join('\n'),
  });

  it('reports browser claims but never upgrades them to playback or HDR output proof', () => {
    const calls: string[] = [];
    const result = probeNativeDolbyVisionCapabilities(report, (mime) => {
      calls.push(mime);
      return mime.startsWith('video/mp4') ? 'probably' : 'maybe';
    }, () => ({ matches: true }));
    expect(result.nativeHls).toBe('maybe');
    expect(result.codecs).toEqual([
      { codec: 'dvh1.05.06', profile: 5, family: 'hevc', support: 'probably' },
    ]);
    expect(calls).toContain('video/mp4; codecs="dvh1.05.06"');
    expect(result.hdrDisplayHint).toBe('high');
    expect(result.actualDolbyVisionOutput).toBe('unverified');
    expect(result.dynamicMetadataRendered).toBe('unverified');
    expect(result.bitstreamPassthrough).toBe('unverified');
  });

  it('keeps unknown browser signals unknown and negative signals negative', () => {
    const result = probeNativeDolbyVisionCapabilities(report, (mime) => {
      if (mime.includes('mpegurl')) return '';
      if (mime.includes('mpegURL')) return '';
      throw new Error('API unavailable');
    }, () => { throw new Error('No media-query API'); });
    expect(result.nativeHls).toBe('no');
    expect(result.codecs[0].support).toBe('unknown');
    expect(result.hdrDisplayHint).toBe('unknown');
  });

  it('never assumes a Dolby Vision codec when the media has no declaration', () => {
    const result = probeNativeDolbyVisionCapabilities(
      inspectDolbyVisionFormat({ url: 'https://example.test/regular.m3u8' }),
      () => 'probably',
    );
    expect(result.codecs).toEqual([]);
    expect(result.hdrDisplayHint).toBe('unknown');
    expect(result.actualDolbyVisionOutput).toBe('unverified');
  });

  it('does not confuse HDR display hints with supported video codecs', () => {
    const result = probeNativeDolbyVisionCapabilities(report, () => '', () => ({ matches: true }));
    expect(result.codecs[0].support).toBe('no');
    expect(result.hdrDisplayHint).toBe('high');
    expect(result.actualDolbyVisionOutput).toBe('unverified');
  });
});
