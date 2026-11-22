import { describe, expect, it } from 'vitest';
import { getMediaPlaybackKind } from './media-playback';

describe('getMediaPlaybackKind', () => {
  it('recognizes HLS manifests with query strings', () => {
    expect(getMediaPlaybackKind('https://media.example/live.m3u8?token=abc')).toBe('hls');
  });

  it.each([
    'https://media.example/movie.mp4',
    'https://media.example/movie.m4v',
    'https://media.example/movie.mov',
  ])('routes progressive MP4-family media: %s', (url) => {
    expect(getMediaPlaybackKind(url)).toBe('mp4');
  });

  it('recognizes WebM', () => {
    expect(getMediaPlaybackKind('https://media.example/movie.webm')).toBe('webm');
  });

  it('recognizes DASH MPD manifests with query strings', () => {
    expect(getMediaPlaybackKind('https://media.example/manifest.mpd?token=abc')).toBe('dash');
  });

  it('uses an explicit DASH type hint for extensionless manifests', () => {
    expect(getMediaPlaybackKind('https://media.example/manifest?id=123', 'dash')).toBe('dash');
  });

  it('uses a validated media type hint for extensionless URLs', () => {
    expect(getMediaPlaybackKind('https://media.example/stream?id=123', 'mp4')).toBe('mp4');
    expect(getMediaPlaybackKind('https://media.example/stream?id=123', 'webm')).toBe('webm');
    expect(getMediaPlaybackKind('https://media.example/stream?id=123', 'hls')).toBe('hls');
  });

  it('preserves legacy extensionless HLS URLs', () => {
    expect(getMediaPlaybackKind('https://media.example/play?id=123')).toBe('hls');
  });
});
