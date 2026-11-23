import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';
import { selectPreferredTmdbBackdrop, selectPreferredTmdbPoster, type TmdbPosterImage } from '@/lib/poster/tmdb-poster-preference';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MediaType = 'movie' | 'tv';
const CACHE_TTL = 6 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const params = new URL(req.url).searchParams;
  const type = params.get('type');
  const id = params.get('id') || '';
  if (type !== 'movie' && type !== 'tv') {
    return NextResponse.json({ error: 'type 仅支持 movie 或 tv' }, { status: 400 });
  }
  if (!/^\d{1,12}$/.test(id) || Number(id) <= 0) {
    return NextResponse.json({ error: 'TMDB ID 无效' }, { status: 400 });
  }

  const language = (params.get('language') || 'zh-CN').slice(0, 12);
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(language)) {
    return NextResponse.json({ error: 'language 无效' }, { status: 400 });
  }
  const cacheKey = `tmdb:details:${type}:${id}:${language}`;
  const cached = getCache<Record<string, unknown>>(cacheKey);
  if (cached) return NextResponse.json(cached, {
    headers: { 'Cache-Control': 'public, max-age=900, s-maxage=21600, stale-while-revalidate=86400' },
  });

  try {
    const payload = await fetchTmdbJson<Record<string, unknown> & { poster_path?: string | null; backdrop_path?: string | null; images?: { posters?: TmdbPosterImage[]; backdrops?: TmdbPosterImage[] } }>(`/${type}/${id}`, {
      language,
      append_to_response: 'images,credits,videos,release_dates,content_ratings',
      include_image_language: 'zh,null,en',
    });
    const preferredPoster = selectPreferredTmdbPoster(payload.images?.posters, payload.poster_path);
    const preferredBackdrop = selectPreferredTmdbBackdrop(payload.images?.backdrops, payload.backdrop_path);
    const result = {
      ...payload,
      ...(preferredPoster ? { poster_path: preferredPoster } : {}),
      ...(preferredBackdrop ? { backdrop_path: preferredBackdrop } : {}),
    };
    setCache(cacheKey, result, CACHE_TTL);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=900, s-maxage=21600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = /^TMDB_HTTP_(404|401|403|429)$/.exec(message)?.[1];
    const httpStatus = status === '404' ? 404 : status === '429' ? 429 : 502;
    const safeMessage = status === '404'
      ? 'TMDB 中没有找到这部影片'
      : status === '401' || status === '403'
        ? 'TMDB 访问凭据无效，请检查 Preview 环境配置'
        : status === '429'
          ? 'TMDB 请求过于频繁，请稍后重试'
          : '暂时无法获取 TMDB 影片详情';
    console.error('[TMDB details] request failed', { type, code: status ? `TMDB_HTTP_${status}` : 'TMDB_UPSTREAM_ERROR' });
    return NextResponse.json({ error: safeMessage }, { status: httpStatus, headers: { 'Cache-Control': 'no-store' } });
  }
}
