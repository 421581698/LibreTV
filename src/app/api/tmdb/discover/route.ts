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
  backdrop_path?: string | null;
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

/**
 * Keep provider failures distinguishable without ever returning credentials or
 * raw upstream response bodies to the browser.
 */
function classifyTmdbFailure(error: unknown): {
  code: string;
  message: string;
  upstreamStatus?: number;
} {
  const detail = error instanceof Error ? error.message : String(error);
  const statusMatch = /^TMDB_HTTP_(\d{3})$/.exec(detail);
  const upstreamStatus = statusMatch ? Number(statusMatch[1]) : undefined;

  if (upstreamStatus === 401 || upstreamStatus === 403) {
    return {
      code: 'TMDB_AUTH_REJECTED',
      message: 'TMDB 拒绝了访问凭据，请检查 Preview 环境中的 API 读访问令牌。',
      upstreamStatus,
    };
  }
  if (upstreamStatus === 429) {
    return {
      code: 'TMDB_RATE_LIMITED',
      message: 'TMDB 请求过于频繁，请稍后重试。',
      upstreamStatus,
    };
  }
  if (upstreamStatus !== undefined) {
    return {
      code: 'TMDB_UPSTREAM_HTTP_ERROR',
      message: 'TMDB 上游服务暂时无法完成请求。',
      upstreamStatus,
    };
  }
  if (detail.includes('跳转目标被拒绝') || detail.includes('DNS 查询超时')) {
    return {
      code: 'TMDB_NETWORK_POLICY_BLOCKED',
      message: 'Preview Worker 无法通过安全网络检查连接 TMDB。',
    };
  }
  if (/timeout|timed out|aborted/i.test(detail)) {
    return {
      code: 'TMDB_UPSTREAM_TIMEOUT',
      message: '连接 TMDB 超时，请稍后重试。',
    };
  }
  return {
    code: 'TMDB_UPSTREAM_ERROR',
    message: 'TMDB 推荐服务暂时不可用，请稍后重试。',
  };
}

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const params = new URL(req.url).searchParams;
  const mediaType = params.get('type') === 'tv' ? 'tv' : params.get('type') === 'movie' ? 'movie' : null;
  if (!mediaType) return NextResponse.json({ error: 'type 仅支持 movie 或 tv' }, { status: 400 });

  const country = (params.get('country') || 'CN').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: '国家/地区代码无效' }, { status: 400 });
  const region = (params.get('region') || '').toUpperCase();
  if (region && !['US', 'CN', 'GLOBAL'].includes(region)) return NextResponse.json({ error: '地区仅支持 US、CN 或 GLOBAL' }, { status: 400 });

  const tag = ['热门', '最新', '高分'].includes(params.get('tag') || '') ? params.get('tag')! : '热门';
  const page = Math.min(500, Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1));
  const cacheKey = `tmdb:discover:${mediaType}:${country}:${region || 'origin'}:${tag}:${page}`;
  const cached = getCache<{ items: unknown[]; page: number; totalPages: number; country: string; mediaType: string }>(cacheKey);
  if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' } });

  try {
    const query: Record<string, string> = {
      language: 'zh-CN',
      include_image_language: 'zh,null,en',
      ...(region === 'GLOBAL' ? {} : region ? { region } : { with_origin_country: country }),
      sort_by: region && region !== 'GLOBAL' && mediaType === 'movie' ? 'primary_release_date.desc' : sortForTag(tag, mediaType),
      page: String(page),
      include_adult: 'false',
    };
    if (tag === '高分') query['vote_count.gte'] = '100';
    if (region && region !== 'GLOBAL' && mediaType === 'movie') {
      const today = new Date();
      const from = new Date(today);
      from.setUTCFullYear(from.getUTCFullYear() - 1);
      query['primary_release_date.gte'] = from.toISOString().slice(0, 10);
      query['primary_release_date.lte'] = today.toISOString().slice(0, 10);
    }
    const payload = await fetchTmdbJson<TmdbDiscoverResponse>(`/discover/${mediaType}`, query);
    const imageBase = await getTmdbPosterBase();
    const items = (Array.isArray(payload.results) ? payload.results : [])
      .filter((item) => Number.isInteger(item.id) && item.id > 0 && (item.title || item.name))
      .map((item) => ({
        id: String(item.id),
        title: item.title || item.name || '',
        cover: item.poster_path ? `${imageBase}${item.poster_path}` : '',
        ...(item.backdrop_path ? { backdrop: `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` } : {}),
        rating: typeof item.vote_average === 'number' ? item.vote_average.toFixed(1) : undefined,
        isTv: mediaType === 'tv',
        year: (item.release_date || item.first_air_date || '').slice(0, 4),
        ...(item.release_date ? { releaseDate: item.release_date } : {}),
        ...(region && item.release_date ? { releaseRegion: region } : {}),
        provider: 'tmdb',
      }))
      .filter((item) => item.cover);
    const result = { items, page, totalPages: Math.max(1, Math.min(500, payload.total_pages || 1)), country, mediaType };
    setCache(cacheKey, result, CACHE_TTL);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=3600' } });
  } catch (error) {
    const notConfigured = error instanceof Error && error.message === 'TMDB_NOT_CONFIGURED';
    if (notConfigured) {
      return NextResponse.json(
        { error: 'TMDB 服务尚未配置，请在 Preview Worker 中设置访问密钥', code: 'TMDB_NOT_CONFIGURED' },
        { status: 424, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const failure = classifyTmdbFailure(error);
    // Deliberately log only a classified code and HTTP status; never log tokens,
    // authorization headers, or upstream response bodies.
    console.error('[TMDB discover] request failed', {
      code: failure.code,
      upstreamStatus: failure.upstreamStatus ?? null,
    });
    return NextResponse.json(
      {
        error: failure.message,
        code: failure.code,
        ...(failure.upstreamStatus ? { upstreamStatus: failure.upstreamStatus } : {}),
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
