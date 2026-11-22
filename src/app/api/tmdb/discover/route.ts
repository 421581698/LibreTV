import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson, getTmdbPosterBase } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TmdbDiscoverItem {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}

interface TmdbDiscoverResponse {
  results?: TmdbDiscoverItem[];
  total_pages?: number;
}

const CACHE_TTL = 60 * 60 * 1000;

function sortForTag(tag: string, mediaType: 'movie' | 'tv'): string {
  if (tag === '最新') return mediaType === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc';
  if (tag === '高分') return 'vote_average.desc';
  return 'popularity.desc';
}

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const params = new URL(req.url).searchParams;
  const mediaType = params.get('type') === 'tv' ? 'tv' : params.get('type') === 'movie' ? 'movie' : null;
  if (!mediaType) return NextResponse.json({ error: 'type 仅支持 movie 或 tv' }, { status: 400 });

  const country = (params.get('country') || 'CN').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: '国家/地区代码无效' }, { status: 400 });

  const tag = ['热门', '最新', '高分'].includes(params.get('tag') || '') ? params.get('tag')! : '热门';
  const page = Math.min(500, Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1));
  const cacheKey = `tmdb:discover:${mediaType}:${country}:${tag}:${page}`;
  const cached = getCache<{ items: unknown[]; page: number; totalPages: number; country: string; mediaType: string }>(cacheKey);
  if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' } });

  try {
    const query: Record<string, string> = {
      language: 'zh-CN',
      with_origin_country: country,
      sort_by: sortForTag(tag, mediaType),
      page: String(page),
      include_adult: 'false',
    };
    if (tag === '高分') query['vote_count.gte'] = '100';
    const payload = await fetchTmdbJson<TmdbDiscoverResponse>(`/discover/${mediaType}`, query);
    const imageBase = await getTmdbPosterBase();
    const items = (Array.isArray(payload.results) ? payload.results : [])
      .filter((item) => Number.isInteger(item.id) && item.id > 0 && (item.title || item.name))
      .map((item) => ({
        id: String(item.id),
        title: item.title || item.name || '',
        cover: item.poster_path ? `${imageBase}${item.poster_path}` : '',
        rating: typeof item.vote_average === 'number' ? item.vote_average.toFixed(1) : undefined,
        isTv: mediaType === 'tv',
        year: (item.release_date || item.first_air_date || '').slice(0, 4),
        provider: 'tmdb',
      }))
      .filter((item) => item.cover);
    const result = { items, page, totalPages: Math.max(1, Math.min(500, payload.total_pages || 1)), country, mediaType };
    setCache(cacheKey, result, CACHE_TTL);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' } });
  } catch (error) {
    const notConfigured = error instanceof Error && error.message === 'TMDB_NOT_CONFIGURED';
    return NextResponse.json(
      { error: notConfigured ? 'TMDB 服务尚未配置，请在 Preview Worker 中设置访问密钥' : '暂时无法获取中国影视内容', code: notConfigured ? 'TMDB_NOT_CONFIGURED' : 'TMDB_DISCOVER_UNAVAILABLE' },
      { status: notConfigured ? 503 : 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
