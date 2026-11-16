import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!query || query.length > 50) return NextResponse.json({ resources: [], queued: [] }, { status: 200 });
  return collectorRequest(`/v1/registry/search?q=${encodeURIComponent(query)}`, {}, 2_000, request);
}
