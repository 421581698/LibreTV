import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const limit = new URL(request.url).searchParams.get('limit') ?? '50';
  return collectorRequest(`/v1/jobs?limit=${encodeURIComponent(limit)}`, {}, 5_000, request);
}
