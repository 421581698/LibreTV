import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { isAuthDisabled } from '@/lib/auth';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HASH = /^[a-f0-9]{64}$/;

export async function GET(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  if (isAuthDisabled()) {
    return NextResponse.json(
      { code: 'DV_CMS_BINDING_AUTH_REQUIRED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const params = new URL(request.url).searchParams;
  const sourceKey = params.get('sourceKey') ?? '';
  const vodId = params.get('vodId') ?? '';
  const episodeIndex = params.get('episodeIndex') ?? '';
  const providerUrlSha256 = params.get('providerUrlSha256') ?? '';
  const playbackUrlSha256 = params.get('playbackUrlSha256') ?? '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sourceKey) ||
      !vodId || vodId.length > 256 ||
      !/^\d{1,4}$/.test(episodeIndex) ||
      !HASH.test(providerUrlSha256) || !HASH.test(playbackUrlSha256)) {
    return NextResponse.json(
      { code: 'DV_CMS_BINDING_IDENTITY_INVALID' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const query = new URLSearchParams({
    source_key: sourceKey,
    vod_id: vodId,
    episode_index: episodeIndex,
    provider_url_sha256: providerUrlSha256,
    playback_url_sha256: playbackUrlSha256,
  });
  const upstream = await collectorRequest(
    `/v1/registry/cms-asset-bindings?${query.toString()}`,
    {},
    5_000,
  );
  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : upstream.status === 409 ? 409 : 503;
    return NextResponse.json(
      { code: status === 404 ? 'DV_CMS_BINDING_NOT_FOUND' : status === 409 ? 'DV_CMS_BINDING_NOT_ELIGIBLE' : 'DV_CMS_BINDING_UNAVAILABLE' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const payload: unknown = await upstream.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json(
      { code: 'DV_CMS_BINDING_RESPONSE_INVALID' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const data = payload as Record<string, unknown>;
  const mp4Binding = data.contentType === 'video/mp4' && data.mediaType === 'mp4' &&
    (data.graphId === null || data.graphId === undefined);
  const hlsBinding = data.contentType === 'application/vnd.apple.mpegurl' && data.mediaType === 'hls' &&
    data.graphId === data.assetId;
  if (typeof data.resourceId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.resourceId) ||
      typeof data.assetId !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(data.assetId) ||
      typeof data.sha256 !== 'string' || !HASH.test(data.sha256) ||
      typeof data.byteLength !== 'number' || !Number.isSafeInteger(data.byteLength) || data.byteLength <= 0 ||
      (!mp4Binding && !hlsBinding) || data.rpuPresence !== 'unknown') {
    return NextResponse.json(
      { code: 'DV_CMS_BINDING_RESPONSE_INVALID' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(data, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
