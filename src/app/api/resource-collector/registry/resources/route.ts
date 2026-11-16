import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const url = new URL(request.url);
  const query = new URLSearchParams({
    q: url.searchParams.get('q') ?? '',
    verified_only: url.searchParams.get('verified_only') ?? 'true',
    limit: url.searchParams.get('limit') ?? '30',
  });
  return collectorRequest(`/v1/registry/resources?${query.toString()}`, {}, 5_000, request);
}

export async function POST(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const body = await request.text();
  if (body.length > 64 * 1024) return NextResponse.json({ error: '请求体过大' }, { status: 413 });
  return collectorRequest('/v1/registry/resources', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }, 5_000, request);
}
