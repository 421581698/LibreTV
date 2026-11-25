import { describe, expect, it } from 'vitest';
import { inspectHlsDolbyVisionManifestEvidence } from './hls-manifest-evidence';

describe('inspectHlsDolbyVisionManifestEvidence', () => {
  it('associates Dolby Vision declarations with individual variants', () => {
    const result = inspectHlsDolbyVisionManifestEvidence([
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="avc1.640028"',
      'sdr/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=12000000,CODECS="hvc1.2.4.L153.B0,dvh1.08.06"',
      'dv/index.m3u8',
    ].join('\n'));
    expect(result).toMatchObject({
      validMasterPlaylist: true,
      declaredVariantCount: 1,
      variants: [
        { uri: 'sdr/index.m3u8', declaredDolbyVision: false, rpuPresence: 'unknown' },
        { uri: 'dv/index.m3u8', declaredDolbyVision: true, profile: 8, rpuPresence: 'unknown' },
      ],
    });
  });

  it('does not claim RPU presence from manifest declarations', () => {
    const result = inspectHlsDolbyVisionManifestEvidence('#EXTM3U\n#EXT-X-STREAM-INF:CODECS="dvh1.08.06"\nvariant.m3u8');
    expect(result.rpuPresence).toBe('unknown');
    expect(result.variants[0].rpuPresence).toBe('unknown');
  });

  it('rejects a missing variant URI or malformed master playlist structure', () => {
    expect(inspectHlsDolbyVisionManifestEvidence('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1').validMasterPlaylist).toBe(false);
    expect(inspectHlsDolbyVisionManifestEvidence('not-hls').validMasterPlaylist).toBe(false);
  });
});
