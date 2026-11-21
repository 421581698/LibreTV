import { describe, expect, it } from 'vitest';
import { sanitizePlaybackSnapshot } from './snapshot-sanitizer';

describe('sanitizePlaybackSnapshot', () => {
  it('removes media URLs and error details before publishing diagnostics', () => {
    const snapshot = sanitizePlaybackSnapshot({
      phase: 'error',
      source: {
        url: 'https://media.example/stream.m3u8?token=secret',
        kind: 'hls',
        sourceId: 'source-1',
        episodeId: 'episode-2',
      },
      currentTime: 12,
      duration: 120,
      bufferedAhead: 3,
      volume: 1,
      muted: false,
      playbackRate: 1,
      seeking: false,
      error: {
        code: 'NETWORK',
        message: 'failed https://media.example/stream.m3u8?token=secret',
        recoverable: true,
        cause: new Error('Authorization: Bearer secret'),
      },
      updatedAt: 123,
    });

    expect(snapshot).toMatchObject({
      phase: 'error',
      currentTime: 12,
      error: { code: 'NETWORK', recoverable: true },
    });
    expect(JSON.stringify(snapshot)).not.toContain('media.example');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect('source' in snapshot).toBe(false);
  });
});
