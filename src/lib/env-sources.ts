import type { SourceConfig } from './types';

/**
 * 内置 Apple CMS 点播源。
 * 这些地址来自项目维护者显式配置；实际请求仍统一经过 fetchUpstream 与 SSRF/DNS 校验。
 * weight 越小，默认展示/搜索顺序越靠前；健康排序可在运行时调整。
 */
export const BUILTIN_SOURCES: SourceConfig[] = [
  {
    key: 'gsm3u8',
    name: '光速资源',
    type: 1,
    api: 'https://api.guangsuapi.com/api.php/provide/vod/?ac=list',
    url: 'https://api.guangsuapi.com/api.php/provide/vod/?ac=list',
    from: 'https://api.guangsuapi.com/api.php/provide/vod/from/gsm3u8/',
    weight: 1,
  },
  {
    key: 'jsm3u8',
    name: '极速资源',
    type: 1,
    api: 'https://jszyapi.com/api.php/provide/vod/?ac=list',
    url: 'https://jszyapi.com/api.php/provide/vod/?ac=list',
    from: 'https://jszyapi.com/api.php/provide/vod/from/jsm3u8/',
    weight: 2,
  },
  {
    key: 'wjm3u8',
    name: '无尽资源',
    type: 1,
    api: 'https://api.wujinapi.com/api.php/provide/vod/?ac=list',
    url: 'https://api.wujinapi.com/api.php/provide/vod/?ac=list',
    from: 'https://api.wujinapi.com/api.php/provide/vod/from/wjm3u8/',
    weight: 3,
  },
  {
    key: 'hnm3u8',
    name: '红牛资源',
    type: 1,
    api: 'https://www.hongniuzy2.com/api.php/provide/vod/?ac=list',
    url: 'https://www.hongniuzy2.com/api.php/provide/vod/?ac=list',
    from: 'https://www.hongniuzy2.com/api.php/provide/vod/from/hnm3u8/',
    weight: 4,
  },
  {
    key: 'dbm3u8',
    name: '百度资源',
    type: 1,
    api: 'https://api.apibdzy.com/api.php/provide/vod/?ac=list',
    url: 'https://api.apibdzy.com/api.php/provide/vod/?ac=list',
    from: 'https://api.apibdzy.com/api.php/provide/vod/from/dbm3u8/',
    weight: 5,
  },
  {
    key: 'zuidam3u8',
    name: '最大资源',
    type: 1,
    api: 'https://api.zuidapi.com/api.php/provide/vod/?ac=list',
    url: 'https://api.zuidapi.com/api.php/provide/vod/?ac=list',
    from: 'https://api.zuidapi.com/api.php/provide/vod/from/zuidam3u8/',
    weight: 6,
  },
];

/**
 * 部署者通过 DEFAULT_SOURCES 环境变量额外预置的采集站。
 * 格式为 JSON 数组：[{"name":"源名","url":"https://.../api.php/provide/vod","detail":"https://..."}]
 * 解析失败时告警并忽略部署者配置，但不影响内置源。
 */
export function getEnvSources(): SourceConfig[] {
  const raw = process.env.DEFAULT_SOURCES;
  if (!raw || !raw.trim()) return [...BUILTIN_SOURCES];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('必须是 JSON 数组');
    const list: SourceConfig[] = parsed.map((item, i) => {
      if (typeof item !== 'object' || item === null) {
        throw new Error(`第 ${i + 1} 项不是对象`);
      }
      const { key: rawKey, name, url, detail, isAdult } = item as Record<string, unknown>;
      const configuredKey = typeof rawKey === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(rawKey.trim())
        ? rawKey.trim()
        : `env_${i}`;
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error(`第 ${i + 1} 项缺少 name`);
      }
      if (typeof url !== 'string' || !/^https?:\\/\\//.test(url.trim())) {
        throw new Error(`第 ${i + 1} 项的 url 必须以 http:// 或 https:// 开头`);
      }
      return {
        key: configuredKey,
        name: name.trim(),
        url: url.trim().replace(/\\/+$/, ''),
        detail: typeof detail === 'string' && detail.trim() ? detail.trim() : undefined,
        isAdult: isAdult === true,
      };
    });
    const keys = new Set(BUILTIN_SOURCES.map((source) => source.key));
    return [...BUILTIN_SOURCES, ...list.filter((source) => !keys.has(source.key))];
  } catch (err) {
    console.warn('[LibreTV] DEFAULT_SOURCES 解析失败，已忽略：', err instanceof Error ? err.message : err);
    return [...BUILTIN_SOURCES];
  }
}
