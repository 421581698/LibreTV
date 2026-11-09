import { NextRequest, NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVICE_TIMEOUT_MS = 65_000;

function collectorConfig() {
  const base = process.env.SCRAPLING_API_BASE?.trim().replace(/\/$/, '');
  const token = process.env.SCRAPLING_API_TOKEN?.trim();
  if (!base || !token) {
    return null;
  }
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'scrapling-collector') {
      return null;
    }
    return { base, token };
  } catch {
    return null;
  }
}

function unavailable() {
  return NextResponse.json(
    { error: 'FMHY / Scrapling 服务尚未连接。请部署 services/scrapling-collector 并配置 SCRAPLING_API_BASE 与 SCRAPLING_API_TOKEN。' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function relay(path: string, init?: RequestInit) {
  const config = collectorConfig();
  if (!config) return unavailable();

  try {
    const response = await fetch(config.base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({ error: 'Collector returned an invalid response.' }));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: '无法连接 Scrapling 采集服务，请检查服务状态和网络配置。' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function GET(request: Request) {
  const guarded = guardRequest(request);
  if (guarded) return guarded;
  const action = new URL(request.url).searchParams.get('action');
  return relay(action === 'tasks' ? '/v1/tasks' : '/v1/discover');
}

export async function POST(request: NextRequest) {
  const guarded = guardRequest(request);
  if (guarded) return guarded;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid collector request.' }, { status: 400 });
  }
  if ('candidateId' in body && typeof body.candidateId === 'string') {
    if (!/^[a-f0-9]{32}$/i.test(body.candidateId)) {
      return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
    }
    return relay(`/v1/candidates/${body.candidateId}/validate`, { method: 'POST' });
  }
  if (!('url' in body) || typeof body.url !== 'string') {
    return NextResponse.json({ error: 'A discovered FMHY site URL is required.' }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(body.url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL.' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return NextResponse.json({ error: 'Only public HTTPS URLs are accepted.' }, { status: 400 });
  }
  return relay('/v1/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: parsed.toString(), limit: 50 }),
  });
}
