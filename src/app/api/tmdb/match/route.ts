import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
type MediaType = 'movie' | 'tv';

function normalizeTitle(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
    .replace(/(?:19|20)\\d{2}/g, '')
    .replace(/[\\s\\p{P}\\p{S}\\p{Z}]+/gu, '');
}

function yearOf(item: SearchItem, type: MediaType): string {
  const date = type === 'movie' ? item.release_date : item.first_air_date;
  return typeof date === 'string' ? date.slice(0, 4) : '';
}

function mediaTitle(item: SearchItem, type: MediaType): string {
  return type === 'movie' ? item.title || '' : item.name || '';
}

function originalMediaTitle(item: SearchItem, type: MediaType): string {
  return type === 'movie' ? item.original_title || '' : item.original_name || '';
}

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const params = new URL(req.url).searchParams;
  const type = params.get('type');
  const year = (params.get('year') || '').trim();
  const titles = [...new Set([
    params.get('title') || '',
    params.get('alternateTitle') || '',
    params.get('originalTitle') || '',
    ...params.getAll('alias'),
  ].map((value) => value.trim().slice(0, 100)).filter((value) => value.length >= 2))];

  if (!titles.length || (type !== 'movie' && type !== 'tv')) {
    return NextResponse.json({ error: '影片标题或类型无效' }, { status: 400 });
  }
  if (year && !/^\\d{4}$/.test(year)) {
    return NextResponse.json({ error: '年份必须为四位数字' }, { status: 400 });
  }

  const mediaType = type as MediaType;
  const normalized = [...new Set(titles.map(normalizeTitle).filter(Boolean))];
  const cacheKey = `tmdb:match:${mediaType}:${year}:${normalized.slice().sort().join('|')}`;
  const cached = getCache<Record<string, unknown>>(cacheKey);
  if (cached) return NextResponse.json(cached, {
    headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' },
  });

  try {
    const byId = new Map<number, { item: SearchItem; score: number; yearMatch: boolean }>();
    // Search every known title. Do not stop at the first partial hit: localized,
    // original-language and CMS aliases may return different candidate sets.
    for (const searchTerm of titles.slice(0, 4)) {
      const payload = await fetchTmdbJson<SearchResponse>(`/search/${mediaType}`, {
        query: searchTerm,
        language: 'zh-CN',
        include_image_language: 'zh,null,en',
        include_adult: 'false',
        page: '1',
      });
      for (const item of Array.isArray(payload.results) ? payload.results : []) {
        if (!Number.isInteger(item.id) || item.id <= 0) continue;
        const localized = normalizeTitle(mediaTitle(item, mediaType));
        const original = normalizeTitle(originalMediaTitle(item, mediaType));
        const localizedMatch = normalized.includes(localized) && Boolean(localized);
        const originalMatch = normalized.includes(original) && Boolean(original);
        if (!localizedMatch && !originalMatch) continue;

        const candidateYear = yearOf(item, mediaType);
        if (year && candidateYear && candidateYear !== year) continue;
        const yearMatch = Boolean(year && candidateYear === year);
        const score = (localizedMatch ? 4 : 0)
          + (originalMatch ? 3 : 0)
          + (yearMatch ? 4 : 0);
        const previous = byId.get(item.id);
        if (!previous || score > previous.score) byId.set(item.id, { item, score, yearMatch });
      }
    }

    const ranked = [...byId.values()].sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const second = ranked[1];
    // If same-title remakes remain indistinguishable, preserve source artwork
    // instead of risking a high-resolution image from the wrong film.
    const ambiguous = Boolean(best && second && (
      best.score === second.score || !year
    ));
    if (!best || ambiguous || best.score < 3) {
      const empty = { match: null };
      setCache(cacheKey, empty, 30 * 60 * 1000);
      return NextResponse.json(empty, {
        headers: { 'Cache-Control': 'public, max-age=300, s-maxage=1800' },
      });
    }

    const candidate = best.item;
    const result = {
      match: {
        id: candidate.id,
        type: mediaType,
        title: mediaTitle(candidate, mediaType),
        year: yearOf(candidate, mediaType),
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
    console.error('[TMDB match] request failed', { type: mediaType, code: status ? `TMDB_HTTP_${status}` : 'TMDB_UPSTREAM_ERROR' });
    return NextResponse.json({ error: 'TMDB 高清图片匹配暂时不可用' }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
