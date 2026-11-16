import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const body = await request.text();
  if (body.length > 16 * 1024) return NextResponse.json({ error: '请求体过大' }, { status: 413 });
  return collectorRequest('/v1/tasks/submit', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }, 5_000, request);
}
