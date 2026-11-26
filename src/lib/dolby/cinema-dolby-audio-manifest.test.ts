import { describe, expect, it, vi } from 'vitest';
import { inspectNativeHlsDolbyAudioCodecs, isDolbyAudioCodec } from './cinema-dolby-audio-manifest';

describe('Cinema Dolby audio delivery evidence', () => {
  it('recognizes only exact AC-3/E-AC-3 codec identifiers', () => {
    expect(isDolbyAudioCodec('ec-3')).toBe(true);
    expect(isDolbyAudioCodec('mp4a.40.2, ac-3')).toBe(true);
    expect(isDolbyAudioCodec('ec-3-joc')).toBe(false);
    expect(isDolbyAudioCodec('atmOS')).toBe(false);
  });
  it('reads a bounded master playlist and ignores non-Dolby codecs', async () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.4d401f,ec-3"\nvideo.m3u8\n';
    const response = new Response(manifest);
    const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
    expect(await inspectNativeHlsDolbyAudioCodecs('https://example.org/master.m3u8', undefined, fetcher)).toEqual(['ec-3']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not advertise capabilities for unreadable and oversized manifests', async () => {
    const bad = vi.fn(async () => new Response('<html>no playlist</html>')) as unknown as typeof fetch;
    expect(await inspectNativeHlsDolbyAudioCodecs('/bad', undefined, bad)).toEqual([]);
    const oversized = vi.fn(async () => new Response('#EXTM3U', { headers: { 'content-length': '900000' } })) as unknown as typeof fetch;
    expect(await inspectNativeHlsDolbyAudioCodecs('/huge', undefined, oversized)).toEqual([]);
  });
});
