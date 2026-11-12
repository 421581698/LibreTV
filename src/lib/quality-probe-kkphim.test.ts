import { describe, expect, it } from 'vitest';
import { extractKkphimEpisodeUrls, parseBestHeight } from './quality-probe';

describe('KKPhim quality probe integration', () => {
  it('extracts HLS and embed URLs from KKPhim episode labels', () => {
    expect(extractKkphimEpisodeUrls([
      'Vietsub · 第1集' + String.fromCharCode(36) + 'https://media.example/1.m3u8',
      'KKPhim · 第2集' + String.fromCharCode(36) + 'https://player.example/embed/2',
      'bad' + String.fromCharCode(36) + 'javascript:alert(1)',
    ])).toEqual([
      'https://media.example/1.m3u8',
      'https://player.example/embed/2',
    ]);
  });

  it('accepts explicit playlist resolution as a declared tier', () => {
    expect(parseBestHeight([
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=12000000,RESOLUTION=3840x2160',
      '4k/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
      '1080/index.m3u8',
    ].join(String.fromCharCode(10)))).toBe(2160);
  });

  it('does not infer 4K from bitrate without a resolution field', () => {
    expect(parseBestHeight([
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=20000000',
      'high/index.m3u8',
    ].join(String.fromCharCode(10)))).toBeUndefined();
  });
});
