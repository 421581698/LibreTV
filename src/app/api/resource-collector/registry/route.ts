import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 20) || 20));
  return collectorRequest(
    `/v1/registry/resources?q=${encodeURIComponent(q)}&limit=${limit}`,
    {},
    10_000,
    request,
  );
}
