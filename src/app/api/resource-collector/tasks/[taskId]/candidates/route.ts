import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const { taskId } = await context.params;
  if (!/^[a-f0-9]{32}$/i.test(taskId)) {
    return NextResponse.json({ error: 'Invalid task ID.' }, { status: 400 });
  }
  return collectorRequest(`/v1/tasks/${taskId}/candidates`, {}, 10_000, request);
}
