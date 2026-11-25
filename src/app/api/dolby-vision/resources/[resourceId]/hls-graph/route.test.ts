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

const resourceId = 'hls-resource-1';
const digest = 'a'.repeat(64);
const root = {
  assetId: 'hls-root',
  resourceId,
  sha256: digest,
  byteLength: 100,
  contentType: 'application/vnd.apple.mpegurl',
  objectKey: `sha256/aa/${digest}`,
};
const initDigest = 'b'.repeat(64);
const segmentDigest = 'c'.repeat(64);
const payload = {
  resourceId,
  graph: { graph_id: root.assetId, resource_id: resourceId, root_asset_id: root.assetId, created_at: 10 },
  rootAsset: root,
  members: [
    { assetId: 'hls-init', resourceId, sha256: initDigest, byteLength: 10, contentType: 'video/mp4', objectKey: `sha256/bb/${initDigest}` },
    { assetId: 'hls-segment', resourceId, sha256: segmentDigest, byteLength: 20, contentType: 'video/iso.segment', objectKey: `sha256/cc/${segmentDigest}` },
  ],
  edges: [
    { parentAssetId: root.assetId, childAssetId: 'hls-init', relativeUri: 'init.mp4', role: 'initialization', ordinal: 0 },
    { parentAssetId: root.assetId, childAssetId: 'hls-segment', relativeUri: 'segment.m4s', role: 'segment', ordinal: 1 },
  ],
};

function makeRequest() {
  return new Request(`https://libretv.example/api/dolby-vision/resources/${resourceId}/hls-graph`);
}

beforeEach(() => {
  vi.mocked(isAuthDisabled).mockReturnValue(false);
  vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json(payload));
});
afterEach(() => vi.clearAllMocks());

describe('GET /api/dolby-vision/resources/[resourceId]/hls-graph', () => {
  it('returns validated immutable initialization and segment identities', async () => {
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resourceId,
      graphId: root.assetId,
      rootAsset: { assetId: root.assetId, sha256: digest },
      members: [
        { assetId: 'hls-init', contentType: 'video/mp4' },
        { assetId: 'hls-segment', contentType: 'video/iso.segment' },
      ],
      edges: [
        { role: 'initialization', childAssetId: 'hls-init' },
        { role: 'segment', childAssetId: 'hls-segment' },
      ],
      rpuPresence: 'unknown',
    });
    expect(collectorRequest).toHaveBeenCalledWith(
      `/v1/registry/resources/${resourceId}/hls-graph`, {}, 5_000,
    );
  });

  it('rejects a graph member with a mismatched content-addressed key', async () => {
    vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json({
      ...payload,
      members: [{ ...payload.members[0], objectKey: 'outside/object' }, payload.members[1]],
    }));
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_HLS_GRAPH_MEMBER_INVALID' });
  });

  it('rejects edges that point outside the returned member set', async () => {
    vi.mocked(collectorRequest).mockResolvedValue(NextResponse.json({
      ...payload,
      edges: [{ ...payload.edges[1], childAssetId: 'unregistered-asset' }],
    }));
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_HLS_GRAPH_EDGE_INVALID' });
  });

  it('fails closed when server authentication is disabled', async () => {
    vi.mocked(isAuthDisabled).mockReturnValue(true);
    const response = await GET(makeRequest(), { params: Promise.resolve({ resourceId }) });
    expect(response.status).toBe(503);
    expect(collectorRequest).not.toHaveBeenCalled();
  });
});
