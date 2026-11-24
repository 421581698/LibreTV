import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { isAuthDisabled } from '@/lib/auth';
import { fetchDolbyVisionRegistryAsset } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORWARDED_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'x-dv-asset-id',
  'x-dv-asset-sha256',
] as const;

/** Authenticated streaming proxy; browser input can select only a bounded byte range. */
export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  if (isAuthDisabled()) {
    return NextResponse.json(
      { code: 'DV_ASSET_STREAM_AUTH_REQUIRED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { assetId } = await context.params;
  if (!/^[A-Za-z0-9:_-]{1,200}$/.test(assetId)) {
    return NextResponse.json(
      { code: 'DV_ASSET_ID_INVALID' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const rangeHeader = request.headers.get('range') ?? undefined;
  if (rangeHeader && (rangeHeader.length > 128 || !/^bytes=\d*-\d*$/.test(rangeHeader) || rangeHeader.includes(','))) {
    return NextResponse.json(
      { code: 'DV_ASSET_RANGE_INVALID' },
      { status: 416, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const upstream = await fetchDolbyVisionRegistryAsset(assetId, 20_000, rangeHeader);
    if (!upstream) {
      return NextResponse.json(
        { code: 'DV_ASSET_REGISTRY_UNAVAILABLE' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      return NextResponse.json(
        { code: 'DV_ASSET_REDIRECT_REJECTED' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (![200, 206, 404, 410, 416].includes(upstream.status)) {
      return NextResponse.json(
        { code: 'DV_ASSET_UPSTREAM_ERROR' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const name of FORWARDED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return NextResponse.json(
      { code: 'DV_ASSET_STREAM_UNAVAILABLE' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
