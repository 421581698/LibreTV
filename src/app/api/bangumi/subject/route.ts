import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchUpstream } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guarded = guardRequest(request);
  if (guarded) return guarded;

  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^\d{1,12}$/.test(id) || Number(id) <= 0) {
    return NextResponse.json({ error: 'Bangumi subject ID 无效' }, { status: 400 });
  }

  try {
    const response = await fetchUpstream('https://api.bgm.tv/v0/subjects/' + id, {
      timeoutMs: 8000,
      headers: {
        'User-Agent': 'LibreTV (+https://github.com/LibreSpark/LibreTV)',
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'Bangumi 作品资料暂时不可用' }, { status: response.status === 404 ? 404 : 502 });
    }
    const subject = await response.json() as Record<string, unknown>;
    return NextResponse.json(subject, {
      headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bangumi 作品资料获取失败' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
