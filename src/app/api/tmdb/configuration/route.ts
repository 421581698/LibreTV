import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson, type TmdbConfiguration } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_KEY = 'tmdb:configuration';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const cached = getCache<TmdbConfiguration>(CACHE_KEY);
  if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800' } });

  try {
    const payload = await fetchTmdbJson<TmdbConfiguration>('/configuration');
    const images = payload?.images;
    if (!images || typeof images.secure_base_url !== 'string' ||
        !images.secure_base_url.startsWith('https://image.tmdb.org/t/p/') ||
        !Array.isArray(images.poster_sizes) || !Array.isArray(images.backdrop_sizes)) {
      throw new Error('TMDB_INVALID_CONFIGURATION');
    }
    const configuration = { images: {
      secure_base_url: images.secure_base_url,
      poster_sizes: images.poster_sizes.filter((size): size is string => typeof size === 'string'),
      backdrop_sizes: images.backdrop_sizes.filter((size): size is string => typeof size === 'string'),
    } };
    setCache(CACHE_KEY, configuration, CACHE_TTL);
    return NextResponse.json(configuration, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800' } });
  } catch (error) {
    const notConfigured = error instanceof Error && error.message === 'TMDB_NOT_CONFIGURED';
    return NextResponse.json(
      { error: notConfigured ? 'TMDB 服务尚未配置' : '暂时无法获取 TMDB 图片配置', code: notConfigured ? 'TMDB_NOT_CONFIGURED' : 'TMDB_CONFIGURATION_UNAVAILABLE' },
      { status: notConfigured ? 503 : 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
