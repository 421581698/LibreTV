import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 6 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const params = new URL(req.url).searchParams;
  const id = params.get('id') || '';
  if (!/^\d{1,12}$/.test(id) || Number(id) <= 0) {
    return NextResponse.json({ error: '人物 TMDB ID 无效' }, { status: 400 });
  }
  const language = (params.get('language') || 'zh-CN').slice(0, 12);
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(language)) {
    return NextResponse.json({ error: 'language 无效' }, { status: 400 });
  }
  const cacheKey = `tmdb:person:${id}:${language}`;
  const cached = getCache<Record<string, unknown>>(cacheKey);
  if (cached) return NextResponse.json(cached, {
    headers: { 'Cache-Control': 'public, max-age=900, s-maxage=21600, stale-while-revalidate=86400' },
  });
  try {
    const result = await fetchTmdbJson<Record<string, unknown>>(`/person/${id}`, {
      language,
      append_to_response: 'images,movie_credits,tv_credits,external_ids',
    });
    setCache(cacheKey, result, CACHE_TTL);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=900, s-maxage=21600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = /^TMDB_HTTP_(404|429)$/.exec(message)?.[1];
    return NextResponse.json(
      { error: status === '404' ? 'TMDB 中没有找到此人物' : status === '429' ? 'TMDB 请求过于频繁，请稍后重试' : '暂时无法获取人物资料' },
      { status: status === '404' ? 404 : status === '429' ? 429 : 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
