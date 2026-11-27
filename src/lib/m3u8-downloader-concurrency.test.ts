import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./m3u8-parse', () => ({
  parseM3u8Playlist: vi.fn(async () => ({
    segments: [{ url: 'https://cdn.example.test/segment-1.ts' }],
    byterange: false,
    initSegment: undefined,
    aesConf: undefined,
    totalDuration: 4,
    mediaSequence: 0,
  })),
}));

import { PauseResumeController, runDownloadJob } from './m3u8-downloader';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HLS concurrent segment scheduling', () => {
  it('never claims a segment beyond playlist length when workers resume', async () => {
    const stored = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (request: Request) => stored.get(request.url)?.clone()),
      put: vi.fn(async (request: Request, response: Response) => {
        stored.set(request.url, response);
      }),
    };
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const bytes: number[] = [];
    const target = {
      kind: 'memory' as const,
      write: vi.fn(async (buffer: Uint8Array) => { bytes.push(...buffer); }),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    await expect(runDownloadJob({
      taskId: 'one-segment-concurrency',
      title: 'Single segment regression',
      url: 'https://cdn.example.test/playlist.m3u8',
      format: 'TS',
      signal: new AbortController().signal,
      pause: new PauseResumeController(),
      onProgress: vi.fn(),
      target,
      concurrency: 16,
    })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(bytes).toEqual([1, 2, 3]);
    expect(target.close).toHaveBeenCalledOnce();
  });
});
