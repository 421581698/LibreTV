import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const guarded = guardRequest(request);
  if (guarded) return guarded;
  const { taskId } = await context.params;
  if (!/^[a-f0-9]{32}$/i.test(taskId)) {
    return NextResponse.json({ error: 'Invalid task ID.' }, { status: 400 });
  }
  return collectorRequest(`/v1/tasks/${taskId}/retry`, { method: 'POST' }, 30_000);
}
