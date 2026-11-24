import { describe, expect, it } from 'vitest';
import { detectMediaFormat } from './format-detector';

describe('detectMediaFormat', () => {
  it('detects HLS and Dolby Digital Plus from declared metadata', () => {
    expect(detectMediaFormat({
      url: 'https://cdn.example/movie.m3u8?token=x',
      codecs: 'avc1.640028,ec-3',
      hlsChannels: '6',
    })).toMatchObject({
      container: 'hls',
      audioCodec: 'eac3',
      dolbyFamily: 'dolby-digital-plus',
      channelCount: 6,
      confidence: 'declared',
    });
  });

  it('treats JOC as an Atmos metadata hint only', () => {
    const report = detectMediaFormat({ mimeType: 'application/vnd.apple.mpegurl', audioCodec: 'ec-3', hlsChannels: '6/JOC' });
    expect(report.dolbyFamily).toBe('dolby-atmos-metadata');
    expect(report.hasJocMarker).toBe(true);
    expect(report.notes.join(' ')).toContain('不证明浏览器已解码 Atmos');
  });

  it('recognizes TrueHD without claiming decode or passthrough', () => {
    const report = detectMediaFormat({ url: 'movie.mkv', audioCodec: 'truehd' });
    expect(report).toMatchObject({ container: 'mkv', audioCodec: 'truehd', dolbyFamily: 'dolby-truehd' });
    expect(report.notes.join(' ')).toContain('不提供 TrueHD 解码或直通');
  });

  it('handles common non-Dolby codecs', () => {
    expect(detectMediaFormat({ url: 'clip.webm', codecs: 'vp9,opus' })).toMatchObject({
      container: 'webm', audioCodec: 'opus', dolbyFamily: 'none',
    });
  });

  it('does not invent a codec or container when metadata is absent', () => {
    expect(detectMediaFormat({})).toMatchObject({
      container: 'unknown', audioCodec: 'unknown', dolbyFamily: 'unknown', confidence: 'unknown',
    });
  });

  it('parses quoted codec strings and ignores URL query suffixes', () => {
    expect(detectMediaFormat({ url: 'https://cdn.example/a.mp4?x=.m3u8', codecs: '"mp4a.40.2"' })).toMatchObject({
      container: 'mp4', audioCodec: 'aac',
    });
  });
});
