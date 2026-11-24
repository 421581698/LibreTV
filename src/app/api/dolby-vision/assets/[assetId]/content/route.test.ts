import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-guard', () => ({
  guardPrivateFeatureRequest: vi.fn(() => null),
}));
vi.mock('@/lib/auth', () => ({
  isAuthDisabled: vi.fn(() => false),
}));
vi.mock('@/lib/resource-collector-client', () => ({
  fetchDolbyVisionRegistryAsset: vi.fn(),
}));

import { isAuthDisabled } from '@/lib/auth';
import { fetchDolbyVisionRegistryAsset } from '@/lib/resource-collector-client';
import { GET } from './route';

const assetId = 'dv_asset-123';

function makeRequest(range?: string) {
  return new Request(`https://libretv.example/api/dolby-vision/assets/${assetId}/content`, {
    headers: range ? { Range: range } : undefined,
  });
}

beforeEach(() => {
  vi.mocked(isAuthDisabled).mockReturnValue(false);
  vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(new Response('2345', {
    status: 206,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': '4',
      'Content-Range': 'bytes 2-5/10',
      'Accept-Ranges': 'bytes',
      ETag: `"${'a'.repeat(64)}"`,
      'X-DV-Asset-ID': assetId,
      'X-DV-Asset-SHA256': 'a'.repeat(64),
    },
  }));
});

afterEach(() => vi.clearAllMocks());

describe('GET /api/dolby-vision/assets/[assetId]/content', () => {
  it('forwards a single byte range and preserves streaming response headers', async () => {
    const response = await GET(makeRequest('bytes=2-5'), {
      params: Promise.resolve({ assetId }),
    });
    expect(fetchDolbyVisionRegistryAsset).toHaveBeenCalledWith(assetId, 20_000, 'bytes=2-5');
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('X-DV-Asset-ID')).toBe(assetId);
    await expect(response.text()).resolves.toBe('2345');
  });

  it('preserves the registry 416 response for unsupported multiple ranges', async () => {
    vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(new Response(null, {
      status: 416,
      headers: { 'Content-Range': 'bytes */10', 'Accept-Ranges': 'bytes' },
    }));
    const response = await GET(makeRequest('bytes=0-1,4-5'), {
      params: Promise.resolve({ assetId }),
    });
    expect(fetchDolbyVisionRegistryAsset).toHaveBeenCalledWith(assetId, 20_000, 'bytes=0-1,4-5');
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */10');
  });

  it('rejects a partial response whose length does not match its byte range', async () => {
    vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(new Response('2345', {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '3',
        'Content-Range': 'bytes 2-5/10',
        'Accept-Ranges': 'bytes',
        ETag: `"${'a'.repeat(64)}"`,
        'X-DV-Asset-ID': assetId,
        'X-DV-Asset-SHA256': 'a'.repeat(64),
      },
    }));
    const response = await GET(makeRequest('bytes=2-5'), { params: Promise.resolve({ assetId }) });
    expect(response.status).toBe(502);
  });

  it('streams immutable HLS playlists and fMP4 segments through the same asset proxy', async () => {
    const playlist = '#EXTM3U\n#EXT-X-ENDLIST\n';
    const playlistDigest = 'c'.repeat(64);
    vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(new Response(playlist, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': String(new TextEncoder().encode(playlist).length),
        'Accept-Ranges': 'bytes',
        ETag: `"${playlistDigest}"`,
        'X-DV-Asset-ID': assetId,
        'X-DV-Asset-SHA256': playlistDigest,
      },
    }));
    const playlistResponse = await GET(makeRequest(), { params: Promise.resolve({ assetId }) });
    expect(playlistResponse.status).toBe(200);
    expect(playlistResponse.headers.get('content-type')).toContain('application/vnd.apple.mpegurl');

    vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(new Response('seg', {
      status: 206,
      headers: {
        'Content-Type': 'video/iso.segment',
        'Content-Length': '3',
        'Content-Range': 'bytes 0-2/8',
        'Accept-Ranges': 'bytes',
        ETag: `"${'d'.repeat(64)}"`,
        'X-DV-Asset-ID': assetId,
        'X-DV-Asset-SHA256': 'd'.repeat(64),
      },
    }));
    const segmentResponse = await GET(makeRequest('bytes=0-2'), { params: Promise.resolve({ assetId }) });
    expect(segmentResponse.status).toBe(206);
    expect(segmentResponse.headers.get('content-type')).toContain('video/iso.segment');
    expect(segmentResponse.headers.get('content-range')).toBe('bytes 0-2/8');
  });

  it('fails closed when authentication is disabled', async () => {
    vi.mocked(isAuthDisabled).mockReturnValue(true);
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ assetId }),
    });
    expect(response.status).toBe(503);
    expect(fetchDolbyVisionRegistryAsset).not.toHaveBeenCalled();
  });
});
