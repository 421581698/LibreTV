import { describe, expect, it } from 'vitest';
import { inspectHlsManifest } from './stream-inspector';

describe('HLS manifest inspection', () => {
  it('inspects master variants and audio/subtitle renditions', () => {
    const result = inspectHlsManifest(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="简体中文",LANGUAGE="zh-Hans",URI="subs/zh.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=4500000,AVERAGE-BANDWIDTH=4000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio",SUBTITLES="subs"
video/1080.m3u8`, 'https://cdn.example.test/master.m3u8');
    expect(result.kind).toBe('master');
    expect(result.variants[0].height).toBe(1080);
    expect(result.variants[0].uri).toBe('https://cdn.example.test/video/1080.m3u8');
    expect(result.renditions).toHaveLength(2);
    expect(result.renditions[0].isDefault).toBe(true);
  });

  it('detects fMP4 media playlists and discontinuities', () => {
    const result = inspectHlsManifest(`#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:5.9,
one.m4s
#EXT-X-DISCONTINUITY
#EXTINF:6.0,
two.m4s
#EXT-X-ENDLIST`);
    expect(result.kind).toBe('media');
    expect(result.hasInitMap).toBe(true);
    expect(result.segmentCount).toBe(2);
    expect(result.discontinuityCount).toBe(1);
    expect(result.isLive).toBe(false);
  });

  it('rejects non-HLS input without throwing', () => {
    expect(inspectHlsManifest('not a manifest').kind).toBe('unknown');
  });
});
