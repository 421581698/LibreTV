import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson, getTmdbPosterBase } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 24 * 60 * 60 * 1000;

interface TmdbSearchResult {
  id: number;
  poster_path?: string | null;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
}

interface TmdbSearchResponse {
  results?: TmdbSearchResult[];
}

function normalizeTitle(value: string | undefined): string {
  return (value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/** Compatibility poster lookup; only returns an exact title/year match to avoid unrelated artwork. */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const url = new URL(req.url);
  const title = (url.searchParams.get('title') || '').trim().slice(0, 100);
  const type = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
  const year = (url.searchParams.get('year') || '').trim();
  if (!title) return NextResponse.json({ error: '缺少影片标题' }, { status: 400 });
  if (year && !/^\d{4}$/.test(year)) return NextResponse.json({ error: '年份格式无效' }, { status: 400 });

  const cacheKey = `tmdb-poster:${type}:${normalizeTitle(title)}:${year}`;
  const cached = getCache<{ poster: string | null; tmdbId: number | null }>(cacheKey + ':v2');
  if (cached !== undefined) return NextResponse.json(cached);

  try {
    const data = await fetchTmdbJson<TmdbSearchResponse>(`/search/${type}`, {
      query: title,
      language: 'zh-CN',
      include_adult: 'false',
      ...(year ? { year } : {}),
    });
    const expected = normalizeTitle(title);
    const result = data.results?.find((entry) => {
      if (!entry.poster_path) return false;
      const names = [entry.title, entry.name, entry.original_title, entry.original_name];
      if (!names.some((name) => normalizeTitle(name) === expected)) return false;
      if (!year) return true;
      const releaseYear = (entry.release_date || entry.first_air_date || '').slice(0, 4);
      return releaseYear === year;
    });
    const imageBase = result?.poster_path ? await getTmdbPosterBase() : '';
    const poster = result?.poster_path ? `${imageBase}${result.poster_path}` : null;
    const payload = { poster, tmdbId: result?.id ?? null };
    setCache(cacheKey + ':v2', payload, CACHE_TTL);
    return NextResponse.json(payload);
  } catch (error) {
    const notConfigured = error instanceof Error && error.message === 'TMDB_NOT_CONFIGURED';
    return NextResponse.json(
      { error: notConfigured ? 'TMDB 服务尚未配置' : 'TMDB 海报查询失败' },
      { status: notConfigured ? 503 : 502 },
    );
  }
}
