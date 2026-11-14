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
  if (action === 'seedhub-detail') {
    const detailUrl = url.searchParams.get('url') ?? '';
    let parsed: URL;
    try { parsed = new URL(detailUrl); } catch {
      return NextResponse.json({ error: 'Invalid SeedHub detail URL.' }, { status: 400 });
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.seedhub.cc' ||
        parsed.username || parsed.password || (parsed.port && parsed.port !== '443') ||
        !/^\/(movies|series|anime)\/\d+\/?$/.test(parsed.pathname)) {
      return NextResponse.json({ error: 'Only SeedHub detail pages are accepted.' }, { status: 400 });
    }
    return collectorRequest('/v1/seedhub/detail?url=' + encodeURIComponent(parsed.toString()), {}, 30_000, request);
  }
  if (action === 'seedhub-catalog') {
    const category = url.searchParams.get('category') ?? 'movies';
    const limit = url.searchParams.get('limit') ?? '50';
    const offset = url.searchParams.get('offset') ?? '0';
    if (!/^(movies|series|anime)$/.test(category) || !/^\d{1,3}$/.test(limit) || !/^\d{1,7}$/.test(offset)) {
      return NextResponse.json({ error: 'Invalid SeedHub catalogue query.' }, { status: 400 });
    }
    return collectorRequest(`/v1/seedhub/catalog?category=${category}&limit=${limit}&offset=${offset}`, {}, 10_000, request);
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
  const payload = body as Record<string, unknown>;
  if (payload.seedhubSync === true) {
    const category = typeof payload.category === 'string' ? payload.category : 'movies';
    const pages = typeof payload.pages === 'number' ? payload.pages : 1;
    if (!/^(movies|series|anime)$/.test(category) || !Number.isInteger(pages) || pages < 1 || pages > 5) {
      return NextResponse.json({ error: 'Invalid SeedHub sync request.' }, { status: 400 });
    }
    return collectorRequest(`/v1/seedhub/sync?category=${category}&pages=${pages}`, { method: 'POST' }, 65_000, request);
  }

  if (typeof payload.candidateId === 'string') {
    if (!/^[a-f0-9]{32}$/i.test(payload.candidateId)) {
      return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
    }
    return collectorRequest(`/v1/candidates/${payload.candidateId}/validate`, { method: 'POST' }, 20_000, request);
  }
  if (typeof payload.url !== 'string' || payload.url.length > 2_048) {
    return NextResponse.json({ error: 'A valid FMHY site URL is required.' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(payload.url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL.' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return NextResponse.json({ error: 'Only public HTTPS URLs on the default port are accepted.' }, { status: 400 });
  }

  return collectorRequest('/v1/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: parsed.toString(), limit: 50 }),
  }, 65_000, request);
}
