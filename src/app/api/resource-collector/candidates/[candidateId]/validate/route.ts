import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ candidateId: string }> }) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const { candidateId } = await context.params;
  if (!/^[a-f0-9]{32}$/i.test(candidateId)) {
    return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
  }
  return collectorRequest(`/v1/candidates/${candidateId}/validate`, { method: 'POST' }, 20_000, request);
}
