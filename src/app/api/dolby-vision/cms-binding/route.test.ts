import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-guard', () => ({ guardPrivateFeatureRequest: vi.fn(() => null) }));
vi.mock('@/lib/auth', () => ({ isAuthDisabled: vi.fn(() => false) }));
vi.mock('@/lib/resource-collector-client', () => ({ collectorRequest: vi.fn() }));

import { collectorRequest } from '@/lib/resource-collector-client';
import { isAuthDisabled } from '@/lib/auth';
import { GET } from './route';

const hash = 'a'.repeat(64);
const payload = {
  resourceId: 'resource-1',
  assetId: 'dv_asset_1',
  sha256: hash,
  byteLength: 1234,
  contentType: 'video/mp4',
  mediaType: 'mp4',
  rpuPresence: 'unknown',
};

function request(episodeIndex = '0') {
  const params = new URLSearchParams({
    sourceKey: 'custom_1',
    vodId: '167277',
    episodeIndex,
    providerUrlSha256: hash,
    playbackUrlSha256: hash,
  });
  return new Request(`https://libretv.example/api/dolby-vision/cms-binding?${params.toString()}`);
}

beforeEach(() => {
  vi.mocked(isAuthDisabled).mockReturnValue(false);
  vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json(payload));
});
afterEach(() => vi.clearAllMocks());

describe('GET /api/dolby-vision/cms-binding', () => {
  it('returns only a validated exact immutable MP4 binding', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject(payload);
    expect(collectorRequest).toHaveBeenCalledWith(
      expect.stringContaining('/v1/registry/cms-asset-bindings?'), {}, 5_000,
    );
  });

  it('rejects malformed or incomplete episode identities', async () => {
    const response = await GET(request('-1'));
    expect(response.status).toBe(400);
    expect(collectorRequest).not.toHaveBeenCalled();
  });

  it('rejects collector responses that do not bind an MP4 asset', async () => {
    vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json({ ...payload, contentType: 'video/webm' }));
    const response = await GET(request());
    expect(response.status).toBe(502);
  });

  it('fails closed when authentication is disabled', async () => {
    vi.mocked(isAuthDisabled).mockReturnValue(true);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(collectorRequest).not.toHaveBeenCalled();
  });
});
