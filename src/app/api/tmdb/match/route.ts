import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MediaType = 'movie' | 'tv';
type SearchItem = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
};
type SearchResponse = { results?: SearchItem[] };

function normalizeTitle(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
    .replace(/(?:19|20)\d{2}/g, '')
    .replace(/[\s\p{P}\p{S}\p{Z}]+/gu, '');
}

function yearOf(item: SearchItem, type: MediaType): string {
  const date = type === 'movie' ? item.release_date : item.first_air_date;
  return typeof date === 'string' ? date.slice(0, 4) : '';
}

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const params = new URL(req.url).searchParams;
  const title = (params.get('title') || '').trim().slice(0, 100);
  const alternateTitle = (params.get('alternateTitle') || '').trim().slice(0, 100);
  const type = params.get('type');
  const year = (params.get('year') || '').trim();

  if (title.length < 2 || (type !== 'movie' && type !== 'tv')) {
    return NextResponse.json({ error: '影片标题或类型无效' }, { status: 400 });
  }
  if (year && !/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: '年份必须为四位数字' }, { status: 400 });
  }

  const titles = [...new Set([title, alternateTitle].filter(Boolean))];
  const normalized = new Set(titles.map(normalizeTitle).filter(Boolean));
  const cacheKey = `tmdb:match:${type}:${year}:${titles.map(normalizeTitle).sort().join('|')}`;
  const cached = getCache<Record<string, unknown>>(cacheKey);
  if (cached) return NextResponse.json(cached, {
    headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' },
  });

  try {
    let candidates: Array<{ item: SearchItem; exact: boolean; yearMatch: boolean; yearConflict: boolean }> = [];
    for (const searchTerm of titles) {
      const payload = await fetchTmdbJson<SearchResponse>(`/search/${type}`, {
        query: searchTerm,
        language: 'zh-CN',
        include_image_language: 'zh,null,en',
        include_adult: 'false',
        page: '1',
      });
      const matches = (Array.isArray(payload.results) ? payload.results : [])
        .filter((item) => Number.isInteger(item.id) && item.id > 0)
        .map((item) => {
          const localized = normalizeTitle(type === 'movie' ? item.title || '' : item.name || '');
          const original = normalizeTitle(type === 'movie' ? item.original_title || '' : item.original_name || '');
          const titleMatch = normalized.has(localized);
          const originalMatch = normalized.has(original);
          const candidateYear = yearOf(item, type);
          return { item, exact: titleMatch || originalMatch, yearMatch: Boolean(year && candidateYear === year), yearConflict: Boolean(year && candidateYear && candidateYear !== year) };
        })
        .filter((candidate) => candidate.exact && !candidate.yearConflict);
      candidates.push(...matches);
      if (matches.length) break;
    }
    candidates.sort((a, b) => Number(b.yearMatch) - Number(a.yearMatch));
    const candidate = candidates[0]?.item;
    if (!candidate) {
      const empty = { match: null };
      setCache(cacheKey, empty, 30 * 60 * 1000);
      return NextResponse.json(empty, {
        headers: { 'Cache-Control': 'public, max-age=300, s-maxage=1800' },
      });
    }

    const result = {
      match: {
        id: candidate.id,
        type,
        title: type === 'movie' ? candidate.title || '' : candidate.name || '',
        year: yearOf(candidate, type),
        posterUrl: candidate.poster_path ? `https://image.tmdb.org/t/p/original${candidate.poster_path}` : '',
        backdropUrl: candidate.backdrop_path ? `https://image.tmdb.org/t/p/original${candidate.backdrop_path}` : '',
      },
    };
    setCache(cacheKey, result, 6 * 60 * 60 * 1000);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=900, s-maxage=21600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = /^TMDB_HTTP_(401|403|429)$/.exec(message)?.[1];
    console.error('[TMDB match] request failed', { type, code: status ? `TMDB_HTTP_${status}` : 'TMDB_UPSTREAM_ERROR' });
    return NextResponse.json({ error: 'TMDB 高清图片匹配暂时不可用' }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
