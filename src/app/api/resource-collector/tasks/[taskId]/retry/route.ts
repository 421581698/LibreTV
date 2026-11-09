import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const guarded = guardRequest(request);
  if (guarded) return guarded;
  const { taskId } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(taskId)) return NextResponse.json({ error: 'Invalid task ID.' }, { status: 400 });
  const base = process.env.SCRAPLING_API_BASE?.trim().replace(/\/$/, '');
  const token = process.env.SCRAPLING_API_TOKEN?.trim();
  if (!base || !token) return NextResponse.json({ error: 'Scrapling service is not configured.' }, { status: 503 });
  try {
    const response = await fetch(base + `/v1/tasks/${taskId}/retry`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store', signal: AbortSignal.timeout(30000),
    });
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to reach Scrapling collector.' }, { status: 502 });
  }
}
