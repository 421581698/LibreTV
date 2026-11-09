import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guarded = guardRequest(request);
  if (guarded) return guarded;
  const base = process.env.SCRAPLING_API_BASE?.trim().replace(/\/$/, '');
  const token = process.env.SCRAPLING_API_TOKEN?.trim();
  if (!base || !token) return NextResponse.json({ error: 'Scrapling service is not configured.' }, { status: 503 });
  try {
    const response = await fetch(base + '/v1/tasks', {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to reach Scrapling collector.' }, { status: 502 });
  }
}
