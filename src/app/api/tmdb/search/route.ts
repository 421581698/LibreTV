import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson, getTmdbPosterBase } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TmdbSearchItem {
  id: number;
  title?: string;
  poster_path?: string | null;
  release_date?: string;
}

interface TmdbSearchResponse {
  results?: TmdbSearchItem[];
}

const CACHE_TTL = 60 * 60 * 1000;

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const params = new URL(req.url).searchParams;
  const query = (params.get('query') || '').trim();
  const region = (params.get('region') || '').toUpperCase();

  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ error: '影片检索词长度必须为 2 至 100 个字符' }, { status: 400 });
  }
  if (!['US', 'CN'].includes(region)) {
    return NextResponse.json({ error: '上映地区仅支持 US 或 CN' }, { status: 400 });
  }

  const cacheKey = `tmdb:search:movie:${region}:${query.toLocaleLowerCase()}`;
  const cached = getCache<{ items: unknown[] }>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' },
    });
  }

  try {
    const payload = await fetchTmdbJson<TmdbSearchResponse>('/search/movie', {
      query,
      region,
      language: 'zh-CN',
      include_adult: 'false',
      page: '1',
    });
    const imageBase = await getTmdbPosterBase();
    const items = (Array.isArray(payload.results) ? payload.results : [])
      .filter((item) => Number.isInteger(item.id) && item.id > 0 && Boolean(item.title?.trim()) && Boolean(item.poster_path) && Boolean(item.release_date))
      .map((item) => ({
        id: String(item.id),
        title: item.title || '',
        cover: imageBase + item.poster_path,
        releaseDate: item.release_date,
        releaseRegion: region as 'US' | 'CN',
        isTv: false,
      }));
    const result = { items };
    setCache(cacheKey, result, CACHE_TTL);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    const statusMatch = /^TMDB_HTTP_(\d{3})$/.exec(detail);
    const upstreamStatus = statusMatch ? Number(statusMatch[1]) : undefined;
    console.error('[TMDB movie search] request failed', {
      code: upstreamStatus ? `TMDB_HTTP_${upstreamStatus}` : 'TMDB_UPSTREAM_ERROR',
    });
    return NextResponse.json(
      { error: 'TMDB 影片检索暂时不可用', ...(upstreamStatus ? { upstreamStatus } : {}) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
