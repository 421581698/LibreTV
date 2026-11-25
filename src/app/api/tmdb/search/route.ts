import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson, getTmdbPosterBase } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TmdbSearchItem {
  id: number;
  title?: string;
  original_title?: string;
  poster_path?: string | null;
}

interface TmdbSearchResponse {
  results?: TmdbSearchItem[];
}

interface TmdbReleaseDate {
  release_date?: string;
  type?: number;
}

interface TmdbReleaseRegion {
  iso_3166_1: string;
  release_dates?: TmdbReleaseDate[];
}

interface TmdbReleaseDatesResponse {
  results?: TmdbReleaseRegion[];
}

const CACHE_TTL = 60 * 60 * 1000;

function actualTheatricalReleaseDate(payload: TmdbReleaseDatesResponse, region: 'US' | 'CN'): string | undefined {
  const dates = (payload.results ?? [])
    .filter((entry) => entry.iso_3166_1 === region)
    .flatMap((entry) => entry.release_dates ?? [])
    // TMDB release types 2 and 3 are theatrical releases. Exclude premieres,
    // digital, physical and TV dates so the rail reflects cinema release dates.
    .filter((entry) => (entry.type === 2 || entry.type === 3) &&
      typeof entry.release_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}/.test(entry.release_date))
    .map((entry) => entry.release_date!.slice(0, 10))
    .sort();
  return dates[0];
}

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

  const regionalCode = region as 'US' | 'CN';
  const cacheKey = `tmdb:search:movie:${regionalCode}:${query.toLocaleLowerCase()}`;
  const cached = getCache<{ items: unknown[] }>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' },
    });
  }

  try {
    const payload = await fetchTmdbJson<TmdbSearchResponse>('/search/movie', {
      query,
      region: regionalCode,
      language: 'zh-CN',
      include_image_language: 'zh,null,en',
      include_adult: 'false',
      page: '1',
    });
    const candidate = (Array.isArray(payload.results) ? payload.results : [])
      .find((item) => Number.isInteger(item.id) && item.id > 0 &&
        item.original_title?.trim().toLocaleLowerCase() === query.toLocaleLowerCase() &&
        Boolean(item.title?.trim()) && Boolean(item.poster_path));

    const imageBase = await getTmdbPosterBase();
    let items: Array<{ id: string; title: string; cover: string; releaseDate: string; releaseRegion: 'US' | 'CN'; isTv: false; provider: 'tmdb' }> = [];
    if (candidate?.poster_path) {
      const releases = await fetchTmdbJson<TmdbReleaseDatesResponse>(`/movie/${candidate.id}/release_dates`);
      const releaseDate = actualTheatricalReleaseDate(releases, regionalCode);
      if (releaseDate) {
        items = [{
          id: String(candidate.id),
          title: candidate.title || '',
          cover: imageBase + candidate.poster_path,
          releaseDate,
          releaseRegion: regionalCode,
          isTv: false,
          provider: 'tmdb',
        }];
      }
    }

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
