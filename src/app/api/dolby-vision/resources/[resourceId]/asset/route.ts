import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { isAuthDisabled } from '@/lib/auth';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_CONTENT_TYPES = new Set([
  'video/mp4',
  'video/webm',
]);

/**
 * Resolve the newest immutable asset attached to one registry resource.
 * This deliberately uses server-configured collector credentials only:
 * browser-supplied collector overrides must never choose a DV evidence asset.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ resourceId: string }> },
) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  if (isAuthDisabled()) {
    return NextResponse.json(
      { code: 'DV_ASSET_LOOKUP_AUTH_REQUIRED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { resourceId } = await context.params;
  if (!/^[a-z0-9_-]{1,80}$/i.test(resourceId)) {
    return NextResponse.json(
      { code: 'DV_RESOURCE_ID_INVALID' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // No Request argument: collectorRequest cannot consume browser-supplied
  // x-scrapling-api-* credentials and must use the server's trusted config.
  const upstream = await collectorRequest(
    `/v1/registry/resources/${encodeURIComponent(resourceId)}`,
    {},
    5_000,
  );
  if (!upstream.ok) {
    return NextResponse.json(
      { code: upstream.status === 404 ? 'DV_RESOURCE_NOT_FOUND' : 'DV_REGISTRY_UNAVAILABLE' },
      { status: upstream.status === 404 ? 404 : 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const payload: unknown = await upstream.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json(
      { code: 'DV_REGISTRY_RESPONSE_INVALID' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const data = payload as Record<string, unknown>;
  const resource = data.resource;
  const assets = data.media_assets;
  if (!resource || typeof resource !== 'object' || Array.isArray(resource) || !Array.isArray(assets)) {
    return NextResponse.json(
      { code: 'DV_REGISTRY_RESPONSE_INVALID' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const record = resource as Record<string, unknown>;
  if (record.id !== resourceId || record.resource_type !== 'DIRECT_MEDIA' ||
      record.access_state !== 'PUBLIC' || record.validation_state !== 'validated' ||
      record.playback_state !== 'PLAYER_CONFIRMED' ||
      !['mp4', 'webm'].includes(String(record.media_format).toLowerCase())) {
    return NextResponse.json(
      { code: 'DV_RESOURCE_NOT_ELIGIBLE' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const expectedContentType = record.media_format === 'webm' ? 'video/webm' : 'video/mp4';
  const asset = assets
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .filter((item) => item.resource_id === resourceId && item.content_type === expectedContentType)
    .sort((a, b) => Number(b.created_at) - Number(a.created_at))[0];

  if (!asset) {
    return NextResponse.json(
      { code: 'DV_ASSET_NOT_REGISTERED' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const assetId = asset.asset_id;
  const digest = asset.sha256;
  const byteLength = asset.byte_length;
  const contentType = asset.content_type;
  if (typeof assetId !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(assetId) ||
      typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) ||
      typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength <= 0 ||
      typeof contentType !== 'string' || !ALLOWED_CONTENT_TYPES.has(contentType) ||
      asset.object_key !== `sha256/${digest.slice(0, 2)}/${digest}`) {
    return NextResponse.json(
      { code: 'DV_ASSET_REGISTRY_BINDING_INVALID' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json({
    resourceId,
    assetId,
    sha256: digest,
    byteLength,
    contentType,
  }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
