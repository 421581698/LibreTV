import { describe, expect, it } from 'vitest';
import { detectMediaFormat } from './format-detector';

describe('detectMediaFormat', () => {
  it('detects HLS and Dolby Digital Plus from declared metadata', () => {
    expect(detectMediaFormat({ url: 'https://cdn.example/movie.m3u8?token=x', codecs: 'avc1.640028,ec-3', hlsChannels: '6' }))
      .toMatchObject({ container: 'hls', audioCodec: 'eac3', dolbyFamily: 'dolby-digital-plus', channelCount: 6, confidence: 'declared' });
  });

  it('treats JOC in CHANNELS as an Atmos metadata hint only', () => {
    const report = detectMediaFormat({ mimeType: 'application/vnd.apple.mpegurl', audioCodec: 'ec-3', hlsChannels: '6/JOC' });
    expect(report.dolbyFamily).toBe('dolby-atmos-metadata');
    expect(report.hasJocMarker).toBe(true);
    expect(report.notes.join(' ')).toContain('不证明浏览器已解码 Atmos');
  });

  it('recognizes JOC in the declared codec token even when CHANNELS omits it', () => {
    expect(detectMediaFormat({ codecs: 'avc1.640028,ec-3-joc', hlsChannels: '6' }))
      .toMatchObject({ audioCodec: 'eac3', dolbyFamily: 'dolby-atmos-metadata', hasJocMarker: true });
  });

  it('parses the four-part Dolby AC-4 codec string without claiming device support', () => {
    const report = detectMediaFormat({ url: 'immersive.m3u8', codecs: 'avc1.640028,ac-4.02.01.04' });
    expect(report).toMatchObject({ audioCodec: 'ac4', dolbyFamily: 'dolby-ac4', ac4Profile: { bitstreamVersion: 2, presentationVersion: 1, mdcompat: 4 } });
    expect(report.notes.join(' ')).toContain('不证明当前设备支持 AC-4 解码或 Atmos 渲染');
  });

  it('recognizes TrueHD without claiming decode or passthrough', () => {
    const report = detectMediaFormat({ url: 'movie.mkv', audioCodec: 'truehd' });
    expect(report).toMatchObject({ container: 'mkv', audioCodec: 'truehd', dolbyFamily: 'dolby-truehd' });
    expect(report.notes.join(' ')).toContain('不提供 TrueHD 解码或直通');
  });

  it('recognizes an explicitly declared Dolby MAT transport marker without claiming passthrough', () => {
    const report = detectMediaFormat({ audioCodec: 'Dolby MAT 2.0' });
    expect(report).toMatchObject({ audioCodec: 'dolby-mat', dolbyFamily: 'dolby-mat' });
    expect(report.notes.join(' ')).toContain('不证明浏览器解码或 HDMI 位流直通');
  });

  it('recognizes DTS:X as a DTS-family hint without claiming decoding', () => {
    expect(detectMediaFormat({ audioCodec: 'DTS:X' })).toMatchObject({ audioCodec: 'dts-x', dolbyFamily: 'none' });
  });

  it('recognizes IAMF and Eclipsa declarations as IAMF-family hints', () => {
    expect(detectMediaFormat({ audioCodec: 'iamf.001' })).toMatchObject({ audioCodec: 'iamf', dolbyFamily: 'none' });
    expect(detectMediaFormat({ audioCodec: 'Eclipsa Audio' })).toMatchObject({ audioCodec: 'iamf', dolbyFamily: 'none' });
  });

  it('recognizes PCM declarations as non-Dolby codec hints', () => {
    expect(detectMediaFormat({ audioCodec: 'lpcm' })).toMatchObject({ audioCodec: 'pcm', dolbyFamily: 'none' });
  });

  it('handles common non-Dolby codecs', () => {
    expect(detectMediaFormat({ url: 'clip.webm', codecs: 'vp9,opus' })).toMatchObject({ container: 'webm', audioCodec: 'opus', dolbyFamily: 'none' });
  });

  it('rejects malformed codec prefixes rather than reporting false Dolby or audio matches', () => {
    const malformed = [
      'fakeac3', 'xtruehdx', 'eac30', 'ec-30', 'dtsx-extra',
      'not-aac', 'pcmish', 'foo-iamf', 'matte', 'prefix-ac-4',
    ];
    for (const audioCodec of malformed) {
      expect(detectMediaFormat({ audioCodec }).audioCodec).toBe('unknown');
    }
  });

  it('prefers the selected audio-track codec over a conflicting variant codec list', () => {
    expect(detectMediaFormat({
      codecs: 'avc1.640028,ac-3',
      audioCodec: 'ec-3',
    })).toMatchObject({ audioCodec: 'eac3', dolbyFamily: 'dolby-digital-plus', codecString: 'ec-3' });
  });

  it('recognizes explicit container codec aliases without prefix matching', () => {
    const cases: Array<[string, string]> = [
      ['A_EAC3', 'eac3'],
      ['A_AC3', 'ac3'],
      ['A_TRUEHD', 'truehd'],
      ['DTS-HD MA', 'dts-hd'],
      ['PCM_S24LE', 'pcm'],
      ['AAC-LC', 'aac'],
      ['A_OPUS', 'opus'],
      ['A_FLAC', 'flac'],
      ['A_ALAC', 'alac'],
    ];
    for (const [audioCodec, expected] of cases) {
      expect(detectMediaFormat({ audioCodec }).audioCodec).toBe(expected);
    }
  });

  it('does not invent a codec or container when metadata is absent', () => {
    expect(detectMediaFormat({})).toMatchObject({ container: 'unknown', audioCodec: 'unknown', dolbyFamily: 'unknown', confidence: 'unknown' });
  });

  it('parses quoted codec strings and ignores URL query suffixes', () => {
    expect(detectMediaFormat({ url: 'https://cdn.example/a.mp4?x=.m3u8', codecs: '"mp4a.40.2"' })).toMatchObject({ container: 'mp4', audioCodec: 'aac' });
  });
});
