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

  it('rejects multiple or malformed ranges before contacting the registry', async () => {
    const response = await GET(makeRequest('bytes=0-1,4-5'), {
      params: Promise.resolve({ assetId }),
    });
    expect(response.status).toBe(416);
    expect(fetchDolbyVisionRegistryAsset).not.toHaveBeenCalled();
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
