import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';

/**
 * 影视热榜聚合（经 60s API，免 key，https://github.com/vikiboss/60s）。
 * 当前只保留百度热播剧榜；豆瓣榜单已停用。
 * 仅使用 API_60S_BASE 指定的自部署实例。
 */

const CACHE_TTL = 60 * 60 * 1000;
const UA = 'LibreTV (+https://github.com/LibreSpark/LibreTV)';

function apiBase(): string {
  return (process.env['API_60S_BASE'] || 'https://60s.viki.moe').replace(/\/+$/, '');
}

/** 豆瓣榜单已停用；仅保留百度热播剧榜。 */
export const HOT_LIST_IDS = ['baidu_teleplay'] as const;

export type HotListId = (typeof HOT_LIST_IDS)[number];

export function isHotListId(id: string): id is HotListId {
  return (HOT_LIST_IDS as readonly string[]).includes(id);
}

// —— 60s API 原始结构（只取用到的字段） ——

interface BaiduTeleplayRaw {
  title?: string;
  cover?: string | null;
}

interface SixtyResponse<T> {
  code?: number;
  data?: T;
}

/** 百度热播剧条目 → DoubanItem；无评分，海报为空的条目丢弃 */
export function baiduTeleplayToItem(raw: BaiduTeleplayRaw, index: number): DoubanItem | undefined {
  if (!raw.title || !raw.cover) return undefined;
  return {
    // 百度榜无稳定 id，用榜单内序号保证 React key 唯一
    id: `baidu_${index}`,
    title: raw.title,
    cover: raw.cover,
    isTv: true,
  };
}

function assertArray<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${what}数据异常`);
  return value as T[];
}

async function fetchJson(path: string): Promise<unknown> {
  const base = apiBase();
  const apiUrl = `${base}${path}`;

  try {
    console.log("【LibreTV Debug】请求的接口地址:", apiUrl);

    const res = await fetchUpstream(apiUrl, {
      timeoutMs: 8000,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.clone().text().catch(() => '');
      const reason = `HTTP ${res.status}`;
      console.warn(`[hot-list] ${apiUrl} 请求失败：${reason}`);
      throw new Error(
        `60s API 请求失败\n` +
        `请求地址: ${apiUrl}\n` +
        `状态码: ${res.status}\n` +
        `响应地址: ${res.url}\n` +
        `响应内容: ${body.slice(0, 1000)}`
      );
    }

    try {
      const data: unknown = await res.json();
      console.info(`[hot-list] ${apiUrl} 请求成功`);
      return data;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[hot-list] ${apiUrl} JSON解析失败：${reason}`);
      throw new Error(`60s API 响应 JSON 解析失败：${reason}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('60s API')) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[hot-list] ${apiUrl} 请求异常：${reason}`);
    throw new Error(`60s API 请求失败：主接口(${new URL(base).host}) ${reason}`);
  }
}

export async function fetchHotList(id: HotListId): Promise<DoubanItem[]> {
  if (id !== 'baidu_teleplay') throw new Error('未知榜单');

  const cacheKey = `hot-list:${id}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  const raw = (await fetchJson('/v2/baidu/teleplay')) as SixtyResponse<BaiduTeleplayRaw[]>;
  const items = assertArray<BaiduTeleplayRaw>(raw.data, '百度热播剧榜')
    .map((entry, index) => baiduTeleplayToItem(entry, index))
    .filter((item): item is DoubanItem => item !== undefined);

  if (items.length === 0) throw new Error('榜单数据为空');

  setCache(cacheKey, items, CACHE_TTL);
  return items;
}
