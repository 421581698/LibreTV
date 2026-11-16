import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const { jobId } = await context.params;
  if (!/^[a-f0-9]{32}$/i.test(jobId)) return NextResponse.json({ error: '任务 ID 无效' }, { status: 400 });
  return collectorRequest(`/v1/jobs/${jobId}`, {}, 5_000, request);
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const { jobId } = await context.params;
  if (!/^[a-f0-9]{32}$/i.test(jobId)) return NextResponse.json({ error: '任务 ID 无效' }, { status: 400 });
  return collectorRequest(`/v1/jobs/${jobId}/retry`, { method: 'POST' }, 5_000, request);
}

export async function DELETE(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const { jobId } = await context.params;
  if (!/^[a-f0-9]{32}$/i.test(jobId)) return NextResponse.json({ error: '任务 ID 无效' }, { status: 400 });
  return collectorRequest(`/v1/jobs/${jobId}/cancel`, { method: 'POST' }, 5_000, request);
}
