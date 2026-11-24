import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-guard', () => ({
  guardPrivateFeatureRequest: vi.fn(() => null),
}));
vi.mock('@/lib/auth', () => ({
  isAuthDisabled: vi.fn(() => false),
}));
vi.mock('@/lib/resource-collector-client', () => ({
  collectorRequest: vi.fn(),
}));

import { collectorRequest } from '@/lib/resource-collector-client';
import { isAuthDisabled } from '@/lib/auth';
import { GET } from './route';

const resourceId = 'registry-resource-1';
const asset = {
  asset_id: 'dv_asset-123',
  resource_id: resourceId,
  sha256: 'a'.repeat(64),
  byte_length: 4096,
  content_type: 'video/mp4',
  object_key: `sha256/aa/${'a'.repeat(64)}`,
  created_at: 10,
};
const registryPayload = {
  resource: {
    id: resourceId,
    resource_type: 'DIRECT_MEDIA',
    access_state: 'PUBLIC',
    validation_state: 'validated',
    playback_state: 'PLAYER_CONFIRMED',
    media_format: 'mp4',
  },
  media_assets: [asset],
  hls_graphs: [],
};

function makeRequest(headers?: HeadersInit) {
  return new Request(`https://libretv.example/api/dolby-vision/resources/${resourceId}/asset`, { headers });
}

beforeEach(() => {
  vi.mocked(isAuthDisabled).mockReturnValue(false);
  vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json(registryPayload));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/dolby-vision/resources/[resourceId]/asset', () => {
  it('resolves only an eligible asset from the trusted server-side registry response', async () => {
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    await expect(response.json()).resolves.toEqual({
      resourceId,
      assetId: asset.asset_id,
      sha256: asset.sha256,
      byteLength: asset.byte_length,
      contentType: asset.content_type,
    });
    expect(response.status).toBe(200);
    expect(collectorRequest).toHaveBeenCalledWith(
      `/v1/registry/resources/${resourceId}`,
      {},
      5_000,
    );
  });

  it('selects an asset matching the registry media format', async () => {
    vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json({
      ...registryPayload,
      media_assets: [
        asset,
        { ...asset, asset_id: 'dv_webm-newer', content_type: 'video/webm', created_at: 20 },
      ],
    }));
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ assetId: asset.asset_id, contentType: 'video/mp4' });
  });

  it('resolves the explicit HLS graph root rather than a nested playlist', async () => {
    const root = {
      ...asset,
      asset_id: 'dv_hls_root',
      sha256: 'b'.repeat(64),
      byte_length: 512,
      content_type: 'application/vnd.apple.mpegurl',
      object_key: `sha256/bb/${'b'.repeat(64)}`,
    };
    vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json({
      resource: { ...registryPayload.resource, media_format: 'hls' },
      media_assets: [
        root,
        { ...root, asset_id: 'dv_nested_playlist', created_at: 20 },
      ],
      hls_graphs: [{
        graph_id: root.asset_id,
        resource_id: resourceId,
        root_asset_id: root.asset_id,
        created_at: 10,
      }],
    }));
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assetId: root.asset_id,
      contentType: 'application/vnd.apple.mpegurl',
    });
  });

  it('does not resolve HLS playback when no explicit graph root exists', async () => {
    vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json({
      resource: { ...registryPayload.resource, media_format: 'hls' },
      media_assets: [{
        ...asset,
        content_type: 'application/vnd.apple.mpegurl',
      }],
      hls_graphs: [],
    }));
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(404);
  });

  it('does not use browser-provided collector credentials', async () => {
    await GET(makeRequest({
      'x-scrapling-api-base': 'https://attacker.example',
      'x-scrapling-api-token': 'attacker-token',
    }), { params: Promise.resolve({ resourceId }) });
    expect(collectorRequest).toHaveBeenCalledTimes(1);
    expect(collectorRequest).toHaveBeenCalledWith(
      `/v1/registry/resources/${resourceId}`,
      {},
      5_000,
    );
  });

  it('rejects resources that are not confirmed public direct media', async () => {
    vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json({
      ...registryPayload,
      resource: { ...registryPayload.resource, playback_state: 'unverified' },
    }));
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_RESOURCE_NOT_ELIGIBLE' });
  });

  it('rejects an asset whose resource binding or content-addressed key is inconsistent', async () => {
    vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json({
      ...registryPayload,
      media_assets: [{ ...asset, resource_id: 'another-resource' }],
    }));
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_ASSET_NOT_REGISTERED' });

    vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json({
      ...registryPayload,
      media_assets: [{ ...asset, object_key: 'outside/object' }],
    }));
    const invalidKeyResponse = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(invalidKeyResponse.status).toBe(409);
    await expect(invalidKeyResponse.json()).resolves.toMatchObject({ code: 'DV_ASSET_REGISTRY_BINDING_INVALID' });
  });

  it('fails closed when server authentication is disabled', async () => {
    vi.mocked(isAuthDisabled).mockReturnValue(true);
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(503);
    expect(collectorRequest).not.toHaveBeenCalled();
  });
});
