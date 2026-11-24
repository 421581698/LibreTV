import { describe, expect, it } from 'vitest';
import { inspectHlsAudioTrack, parseHlsAudioRenditions } from './audio-inspector';

describe('parseHlsAudioRenditions', () => {
  it('parses declared stereo and multichannel tracks without guessing speaker layout', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="English",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio/en.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="surround",NAME="English 5.1",CHANNELS="6",URI="audio/en-51.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.640028,ec-3",AUDIO="surround"',
      'video/1080p.m3u8',
    ].join('\n');
    const result = parseHlsAudioRenditions(manifest);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'English', channelCount: 2, layout: 'stereo', default: true, autoselect: true });
    expect(result[1]).toMatchObject({ name: 'English 5.1', channelCount: 6, layout: 'unknown', codec: 'ec-3' });
  });

  it('recognizes Dolby AC-4 FourCC in HLS CODECS', () => {
    const manifest = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="immersive",NAME="AC-4",URI="audio/ac4.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="avc1.640028,ac-4.02.01.04",AUDIO="immersive"\nvideo/1080p.m3u8';
    expect(parseHlsAudioRenditions(manifest)[0].codec).toBe('ac-4.02.01.04');
  });

  it('recognizes registered HLS audio sample-entry tokens', () => {
    const cases = ['mlpa', 'dtsc', 'dtsh', 'dtse', 'dtsx', 'lpcm', 'iamf.001'];
    for (const audioCodec of cases) {
      const manifest = [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="g",NAME="Track",URI="audio.m3u8"',
        `#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.640028,${audioCodec}",AUDIO="g"`,
        'video.m3u8',
      ].join('\n');
      expect(parseHlsAudioRenditions(manifest)[0].codec).toBe(audioCodec);
    }
  });

  it('does not treat descriptive labels as registered HLS CODECS sample entries', () => {
    for (const audioCodec of ['truehd', 'mat', 'dts-x', 'eclipsa']) {
      const manifest = [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="g",NAME="Track",URI="audio.m3u8"',
        `#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.640028,${audioCodec}",AUDIO="g"`,
        'video.m3u8',
      ].join('\n');
      expect(parseHlsAudioRenditions(manifest)[0].codec).toBeNull();
    }
  });

  it('validates MPEG-4 audio object identifiers instead of accepting arbitrary suffixes', () => {
    const accepted = '#EXTM3U\\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="g",NAME="AAC",URI="audio.m3u8"\\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.640028,mp4a.40.2",AUDIO="g"\\nvideo.m3u8';
    expect(parseHlsAudioRenditions(accepted)[0].codec).toBe('mp4a.40.2');

    for (const audioCodec of ['mp4a.bad', 'mp4a.4g.2', 'mp4a.40', 'mp4a.40.foo']) {
      const manifest = [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="g",NAME="Unknown",URI="audio.m3u8"',
        `#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.640028,${audioCodec}",AUDIO="g"`,
        'video.m3u8',
      ].join('\\n');
      expect(parseHlsAudioRenditions(manifest)[0].codec).toBeNull();
    }
  });

  it('rejects malformed codec prefixes instead of reporting supported formats', () => {
    const malformed = ['ac-30', 'ec-30', 'dtsx-extra', 'mp4a-not-a-codec', 'truehdx', 'iamf-invalid'];
    for (const audioCodec of malformed) {
      const manifest = [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="g",NAME="Unknown",URI="audio.m3u8"',
        `#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.640028,${audioCodec}",AUDIO="g"`,
        'video.m3u8',
      ].join('\n');
      expect(parseHlsAudioRenditions(manifest)[0].codec).toBeNull();
    }
  });

  it('does not guess a rendition codec when variants sharing a group disagree', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="shared",NAME="English",URI="audio/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="avc1.640028,ec-3",AUDIO="shared"',
      'video/720p.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="avc1.640028,ac-4.02.01.04",AUDIO="shared"',
      'video/1080p.m3u8',
    ].join('\n');

    expect(parseHlsAudioRenditions(manifest)[0]).toMatchObject({
      codec: null,
      hasJocMarker: false,
    });
  });

  it('recognizes JOC in CHANNELS as metadata only', () => {
    expect(parseHlsAudioRenditions('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="E-AC3 JOC",CHANNELS="6/JOC",URI="a.m3u8"')[0])
      .toMatchObject({ channelCount: 6, layout: 'unknown', hasJocMarker: true });
  });

  it('recognizes JOC in the declared CODECS token without CHANNELS suffix', () => {
    const manifest = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="E-AC3",CHANNELS="6",URI="a.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.640028,ec-3-joc",AUDIO="a"\nvideo.m3u8';
    expect(parseHlsAudioRenditions(manifest)[0]).toMatchObject({ codec: null, hasJocMarker: true });
  });

  it('preserves 12/JOC and 16/JOC as declared Atmos metadata without guessing speaker layout', () => {
    for (const channels of ['12/JOC', '16/JOC']) {
      const manifest = [
        '#EXTM3U',
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="atmos",NAME="Dolby metadata fixture",CHANNELS="${channels}",URI="audio.m3u8"`,
        '#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.640028,ec-3",AUDIO="atmos"',
        'video.m3u8',
      ].join('\n');
      expect(parseHlsAudioRenditions(manifest)[0]).toMatchObject({
        channelsRaw: channels,
        channelCount: Number(channels.split('/')[0]),
        layout: 'unknown',
        hasJocMarker: true,
        codec: 'ec-3',
      });
    }
  });

  it('keeps absent and unsupported channel declarations unknown', () => {
    const result = parseHlsAudioRenditions('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Unknown",URI="a.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="b",NAME="7.1",CHANNELS="8",URI="b.m3u8"');
    expect(result.map((item) => [item.channelCount, item.layout])).toEqual([[null, 'unknown'], [8, 'unknown']]);
  });

  it('ignores non-audio renditions and preserves quoted commas', () => {
    expect(parseHlsAudioRenditions('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",URI="s.m3u8"')).toEqual([]);
    expect(parseHlsAudioRenditions('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English, Commentary",CHANNELS="2"')[0].name).toBe('English, Commentary');
  });
});

describe('inspectHlsAudioTrack', () => {
  it('normalizes hls.js metadata', () => {
    expect(inspectHlsAudioTrack({ name: 'English E-AC3', groupId: 'main', url: 'https://cdn.example/a.m3u8', channels: '6/JOC', audioCodec: 'ec-3', default: true }))
      .toMatchObject({ groupId: 'main', channelCount: 6, layout: 'unknown', hasJocMarker: true, codec: 'ec-3', default: true });
  });

  it('detects JOC from the codec token without guessing channel layout', () => {
    expect(inspectHlsAudioTrack({ channels: '6', audioCodec: 'ec-3-joc' }))
      .toMatchObject({ channelCount: 6, layout: 'unknown', hasJocMarker: true });
  });

  it('rejects malformed hls.js codec metadata instead of forwarding it as a known codec', () => {
    expect(inspectHlsAudioTrack({ audioCodec: 'ec-30', channels: '6/JOC' }))
      .toMatchObject({ codec: null, channelCount: 6, layout: 'unknown', hasJocMarker: true });
    expect(inspectHlsAudioTrack({ audioCodec: 'dtsx-extra' }))
      .toMatchObject({ codec: null, hasJocMarker: false });
  });

  it('accepts registered HLS sample-entry tokens but not deprecated or invented suffixes', () => {
    expect(inspectHlsAudioTrack({ audioCodec: 'ec-3-joc' }))
      .toMatchObject({ codec: null, hasJocMarker: true });
    expect(inspectHlsAudioTrack({ audioCodec: 'ec+3' }).codec).toBeNull();
    expect(inspectHlsAudioTrack({ audioCodec: 'dtsc' }).codec).toBe('dtsc');
    expect(inspectHlsAudioTrack({ audioCodec: 'dtsh' }).codec).toBe('dtsh');
    expect(inspectHlsAudioTrack({ audioCodec: 'dtse' }).codec).toBe('dtse');
    expect(inspectHlsAudioTrack({ audioCodec: 'ac-4.02.01.03' }).codec).toBe('ac-4.02.01.03');
  });

  it('keeps missing metadata unknown', () => {
    expect(inspectHlsAudioTrack({ name: 'Unknown' })).toMatchObject({ channelCount: null, layout: 'unknown', hasJocMarker: false });
  });
});
