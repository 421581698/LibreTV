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
  if (rangeHeader && rangeHeader.length > 128) {
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
    if (upstream.status === 200 || upstream.status === 206) {
      const digest = upstream.headers.get('x-dv-asset-sha256') ?? '';
      const contentType = upstream.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      const expectedEtag = `"${digest}"`;
      const contentLength = Number(upstream.headers.get('content-length'));
      const contentRange = upstream.headers.get('content-range') ?? '';
      const rangeMatch = upstream.status === 206
        ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange)
        : null;
      const rangeNumbers = rangeMatch?.slice(1).map(Number) ?? [];
      let requestedRangeMatches = upstream.status !== 206 && !rangeHeader;
      if (upstream.status === 206 && rangeHeader && rangeMatch) {
        const requested = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        const [actualStart, actualEnd, total] = rangeNumbers;
        if (requested && total > 0) {
          const [, first, last] = requested;
          let expectedStart = 0;
          let expectedEnd = total - 1;
          if (!first && last) {
            const suffixLength = Number(last);
            if (Number.isSafeInteger(suffixLength) && suffixLength > 0) {
              expectedStart = Math.max(0, total - suffixLength);
            } else {
              expectedStart = total;
            }
          } else if (first) {
            expectedStart = Number(first);
            expectedEnd = last ? Math.min(Number(last), total - 1) : total - 1;
          } else {
            expectedStart = total;
          }
          requestedRangeMatches = actualStart === expectedStart && actualEnd === expectedEnd;
        }
      }
      const invalidPartialRange = (upstream.status === 206 && (
        !rangeHeader ||
        !rangeMatch ||
        !requestedRangeMatches ||
        !Number.isSafeInteger(contentLength) ||
        rangeNumbers.some((value) => !Number.isSafeInteger(value)) ||
        rangeNumbers[0] > rangeNumbers[1] ||
        rangeNumbers[1] >= rangeNumbers[2] ||
        contentLength !== rangeNumbers[1] - rangeNumbers[0] + 1
      )) || Boolean(rangeHeader && upstream.status === 200);
      if (upstream.headers.get('x-dv-asset-id') !== assetId ||
          !/^[a-f0-9]{64}$/.test(digest) ||
          upstream.headers.get('etag') !== expectedEtag ||
          !['video/mp4', 'video/webm', 'application/vnd.apple.mpegurl', 'video/mp2t', 'video/iso.segment', 'audio/aac', 'audio/mp4', 'audio/mpeg', 'text/vtt'].includes(contentType ?? '') ||
          upstream.headers.get('accept-ranges') !== 'bytes' ||
          !/^\d+$/.test(upstream.headers.get('content-length') ?? '') ||
          !Number.isSafeInteger(contentLength) || contentLength < 0 ||
          invalidPartialRange) {
        return NextResponse.json(
          { code: 'DV_ASSET_UPSTREAM_BINDING_INVALID' },
          { status: 502, headers: { 'Cache-Control': 'no-store' } },
        );
      }
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
