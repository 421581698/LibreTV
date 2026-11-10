import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4_096) {
    return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid job request.' }, { status: 400 });
  }
  const value = body as Record<string, unknown>;
  if (typeof value.url !== 'string' || value.url.length > 2_048 ||
      !['auto', 'http', 'browser'].includes(String(value.mode ?? 'auto'))) {
    return NextResponse.json({ error: 'Invalid crawl URL or mode.' }, { status: 400 });
  }
  return collectorRequest('/v1/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: value.url,
      mode: value.mode ?? 'auto',
      ...(typeof value.idempotency_key === 'string' ? { idempotency_key: value.idempotency_key.slice(0, 160) } : {}),
    }),
  }, 10_000, request);
}
