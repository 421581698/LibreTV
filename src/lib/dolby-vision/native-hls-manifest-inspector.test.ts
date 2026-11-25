import { describe, expect, it, vi } from 'vitest';
import { inspectNativeHlsDolbyVisionManifest } from './native-hls-manifest-inspector';

describe('inspectNativeHlsDolbyVisionManifest', () => {
  it('detects Dolby Vision declarations in a readable native HLS master playlist', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=12000000,CODECS="avc1.640028,dvhe.05.06",VIDEO-RANGE=PQ\nvariant.m3u8\n',
      { status: 200 },
    ));

    const report = await inspectNativeHlsDolbyVisionManifest(
      'https://media.example/master.m3u8',
      undefined,
      fetcher,
    );

    expect(report.detected).toBe(true);
    expect(report.codecFamilies).toContain('hevc');
    expect(report.videoRange).toBe('PQ');
    expect(report.notes.some((note) => note.includes('仍未验证媒体分片 RPU'))).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('https://media.example/master.m3u8', expect.objectContaining({
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    }));
  });

  it('keeps status unknown when cross-origin manifest access is blocked', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    const report = await inspectNativeHlsDolbyVisionManifest(
      'https://media.example/master.m3u8',
      undefined,
      fetcher,
    );

    expect(report.detected).toBe(false);
    expect(report.confidence).toBe('unknown');
    expect(report.notes.some((note) => note.includes('跨域 CORS 限制'))).toBe(true);
  });

  it('does not interpret a non-HLS response as Dolby Vision absence', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>blocked</html>', { status: 200 }));

    const report = await inspectNativeHlsDolbyVisionManifest(
      'https://media.example/master.m3u8',
      undefined,
      fetcher,
    );

    expect(report.detected).toBe(false);
    expect(report.notes.some((note) => note.includes('不是有效的 HLS'))).toBe(true);
  });

  it('rejects oversized manifests without parsing their contents', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      '#EXTM3U\\n' + 'x'.repeat(512 * 1024 + 1),
      { status: 200 },
    ));

    const report = await inspectNativeHlsDolbyVisionManifest(
      'https://media.example/master.m3u8',
      undefined,
      fetcher,
    );

    expect(report.detected).toBe(false);
    expect(report.confidence).toBe('unknown');
    expect(report.notes.some((note) => note.includes('超过 512 KiB'))).toBe(true);
  });

  it('does not block playback or claim absence on an HTTP error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 }));

    const report = await inspectNativeHlsDolbyVisionManifest(
      'https://media.example/master.m3u8',
      undefined,
      fetcher,
    );

    expect(report.detected).toBe(false);
    expect(report.notes.some((note) => note.includes('HTTP 403'))).toBe(true);
  });
});
