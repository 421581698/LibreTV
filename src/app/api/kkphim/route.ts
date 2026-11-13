import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchUpstream } from '@/lib/fetch-utils';
import { KKPHIM_API_ORIGIN } from '@/lib/kkphim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SLUG = /^[\p{L}\p{N}._-]{1,180}$/u;
const LIST_TYPES = new Set(['phim-le', 'phim-bo', 'hoat-hinh', 'tv-shows', 'phim-chieu-rap']);
const ACTIONS = new Set(['home', 'list', 'search', 'detail', 'images', 'people', 'keywords', 'tmdb']);

async function readBounded(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('KKPHIM_RESPONSE_TOO_LARGE');
  if (!response.body) throw new Error('KKPHIM_EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('KKPHIM_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const guarded = guardRequest(request);
  if (guarded) return guarded;

  const params = new URL(request.url).searchParams;
  const action = params.get('action') || 'home';
  if (!ACTIONS.has(action)) return error('不支持的 KKPhim 操作。', 400);

  const upstream = new URL(KKPHIM_API_ORIGIN);
  const slug = (params.get('slug') || '').trim();

  if (action === 'home') {
    upstream.pathname = '/v1/api/home';
  } else if (action === 'list') {
    const type = params.get('type') || 'phim-moi';
    if (type !== 'phim-moi' && !LIST_TYPES.has(type)) return error('无效的影视分类。', 400);
    upstream.pathname = type === 'phim-moi' ? '/v1/api/danh-sach' : `/v1/api/danh-sach/${type}`;
  } else if (action === 'search') {
    const keyword = (params.get('keyword') || '').trim();
    if (!keyword || keyword.length > 80) return error('搜索关键词无效。', 400);
    upstream.pathname = '/v1/api/tim-kiem';
    upstream.searchParams.set('keyword', keyword);
  } else if (action === 'detail') {
    if (!SLUG.test(slug)) return error('影视标识无效。', 400);
    upstream.pathname = `/phim/${encodeURIComponent(slug)}`;
  } else if (action === 'images' || action === 'people' || action === 'keywords') {
    if (!SLUG.test(slug)) return error('影视标识无效。', 400);
    upstream.pathname = `/v1/api/phim/${encodeURIComponent(slug)}/${action === 'images' ? 'images' : action === 'people' ? 'peoples' : 'keywords'}`;
  } else {
    const kind = params.get('kind') || '';
    const id = params.get('id') || '';
    if (!['movie', 'tv'].includes(kind) || !/^\d{1,12}$/.test(id)) return error('TMDB 参数无效。', 400);
    upstream.pathname = `/tmdb/${kind}/${id}`;
  }

  const page = params.get('page');
  if (page && /^\d{1,5}$/.test(page)) upstream.searchParams.set('page', page);
  for (const key of ['limit', 'category', 'country', 'year', 'sort_field', 'sort_type', 'sort_lang']) {
    const value = params.get(key);
    if (value && value.length <= 80) upstream.searchParams.set(key, value);
  }

  try {
    const response = await fetchUpstream(upstream.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'LibreTV-KKPhim-Adapter/1.0' },
      cache: 'no-store',
      timeoutMs: 12_000,
      retries: 0,
      safeRedirects: true,
      allowPrivate: false,
      signal: request.signal,
    });
    if (!response.ok) return error(`KKPhim 上游返回 HTTP ${response.status}。`, 502);
    const payload = await readBounded(response);
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '';
    const status = message === 'KKPHIM_RESPONSE_TOO_LARGE' ? 502 : 502;
    return error(message === 'KKPHIM_RESPONSE_TOO_LARGE' ? 'KKPhim 响应超过 4 MB 安全上限。' : '暂时无法获取 KKPhim 数据。', status);
  }
}
