import { describe, expect, it } from 'vitest';
import { parseHlsAudioRenditions } from './audio-inspector';

describe('parseHlsAudioRenditions', () => {
  it('parses declared stereo and 5.1 tracks and links codecs by audio group', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="English",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio/en.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="surround",NAME="English 5.1",CHANNELS="6",URI="audio/en-51.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.640028,ec-3",AUDIO="surround"',
      'video/1080p.m3u8',
    ].join('\n');

    const result = parseHlsAudioRenditions(manifest);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: 'English', channelCount: 2, layout: 'stereo',
      default: true, autoselect: true, codec: null,
    });
    expect(result[1]).toMatchObject({
      name: 'English 5.1', channelCount: 6, layout: '5.1', codec: 'ec-3',
    });
  });

  it('recognizes the JOC marker without claiming Atmos decoding', () => {
    const manifest = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="E-AC3 JOC",CHANNELS="6/JOC",URI="a.m3u8"';
    expect(parseHlsAudioRenditions(manifest)[0]).toMatchObject({
      channelCount: 6, layout: '5.1', hasJocMarker: true,
    });
  });

  it('does not guess channel layouts when CHANNELS is absent or unsupported', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Unknown",URI="a.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="b",NAME="7.1",CHANNELS="8",URI="b.m3u8"',
    ].join('\n');
    expect(parseHlsAudioRenditions(manifest).map((x) => [x.channelCount, x.layout])).toEqual([
      [null, 'unknown'],
      [8, 'unknown'],
    ]);
  });

  it('ignores non-audio renditions', () => {
    const manifest = '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="sub.m3u8"';
    expect(parseHlsAudioRenditions(manifest)).toEqual([]);
  });

  it('handles quoted commas and whitespace in attribute values', () => {
    const manifest = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English, Commentary",CHANNELS="2",URI="a.m3u8"';
    expect(parseHlsAudioRenditions(manifest)[0].name).toBe('English, Commentary');
  });
});
