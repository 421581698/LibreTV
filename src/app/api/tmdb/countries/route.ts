import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbJson, isTmdbCountry, type TmdbCountry } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_KEY = 'tmdb:countries:zh-CN';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400',
};

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const cached = getCache<TmdbCountry[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ countries: cached, defaultCountry: 'CN', language: 'zh-CN' }, { headers: CACHE_HEADERS });
  }

  try {
    const payload = await fetchTmdbJson<unknown[]>('/configuration/countries', { language: 'zh-CN' });
    if (!Array.isArray(payload)) throw new Error('TMDB_INVALID_COUNTRIES');
    const countries = payload.filter(isTmdbCountry);
    if (!countries.some((country) => country.iso_3166_1 === 'CN')) throw new Error('TMDB_COUNTRY_CN_MISSING');
    countries.sort((a, b) => a.iso_3166_1 === 'CN' ? -1 : b.iso_3166_1 === 'CN' ? 1 : a.native_name.localeCompare(b.native_name, 'zh-CN'));
    setCache(CACHE_KEY, countries, CACHE_TTL);
    return NextResponse.json({ countries, defaultCountry: 'CN', language: 'zh-CN' }, { headers: CACHE_HEADERS });
  } catch (error) {
    const message = error instanceof Error && error.message === 'TMDB_NOT_CONFIGURED'
      ? 'TMDB 服务尚未配置'
      : '暂时无法获取 TMDB 国家/地区列表';
    const status = error instanceof Error && error.message === 'TMDB_NOT_CONFIGURED' ? 503 : 502;
    return NextResponse.json({ error: message, code: status === 503 ? 'TMDB_NOT_CONFIGURED' : 'TMDB_COUNTRIES_UNAVAILABLE' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
