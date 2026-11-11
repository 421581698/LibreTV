import { NextRequest, NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  if (action === 'stats') {
    const host = url.searchParams.get('host');
    const query = host ? '?host=' + encodeURIComponent(host) : '';
    return collectorRequest('/v1/stats' + query, {}, 10_000, request);
  }
  if (action === 'library') {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 100)));
    const offset = Math.max(0, Math.min(1_000_000, Number(url.searchParams.get('offset') || 0)));
    const verifiedOnly = url.searchParams.get('verifiedOnly') !== 'false';
    return collectorRequest('/v1/registry/resources?verified_only=' + String(verifiedOnly) + '&limit=' + limit + '&offset=' + offset, {}, 15_000, request);
  }
  return collectorRequest(action === 'tasks' ? '/v1/tasks' : '/v1/discover', {}, 20_000, request);
}

export async function POST(request: NextRequest) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 8_192) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid collector request.' }, { status: 400 });
  }
  if ('action' in body && body.action === 'batch') {
    return collectorRequest('/v1/batches/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minimum: 101, target: 1000, max_sites: 1000 }),
    }, 20_000, request);
  }
  if ('candidateId' in body && typeof body.candidateId === 'string') {
    if (!/^[a-f0-9]{32}$/i.test(body.candidateId)) {
      return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
    }
    return collectorRequest(`/v1/candidates/${body.candidateId}/validate`, { method: 'POST' }, 20_000, request);
  }
  if (!('url' in body) || typeof body.url !== 'string' || body.url.length > 2_048) {
    return NextResponse.json({ error: 'A valid FMHY site URL is required.' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(body.url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL.' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return NextResponse.json({ error: 'Only public HTTPS URLs on the default port are accepted.' }, { status: 400 });
  }

  return collectorRequest('/v1/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: parsed.toString(), limit: 250 }),
  }, 65_000, request);
}
