import type { SourceConfig } from './types';

/**
 * LibreTV 固定内置点播源。
 * 这些源不依赖 wrangler.toml 的 DEFAULT_SOURCES，避免环境变量遗漏导致三个源消失。
 * 注意：内置只保证配置固定，不代表上游资源站始终在线或允许 Cloudflare 出口访问。
 */
export const BUILTIN_VOD_SOURCES: SourceConfig[] = [
  {
    key: 'builtin_360',
    name: '360资源',
    url: 'https://360zy.com/api.php/provide/vod',
    detail: 'https://360zy.com',
    isAdult: false,
  },
  {
    key: 'builtin_quantum',
    name: '量子资源',
    url: 'https://cj.lziapi.com/api.php/provide/vod/',
    detail: 'https://www.lzizy.net',
    isAdult: false,
  },
  {
    key: 'builtin_feifan',
    name: '非凡资源',
    url: 'http://api.ffzyapi.com/api.php/provide/vod/',
    detail: 'http://api.ffzyapi.com',
    isAdult: false,
  },
];

/**
 * 固定返回三个内置源；DEFAULT_SOURCES 只作为额外自定义源入口，
 * 不允许环境变量覆盖内置源的名称、地址或详情域名。
 */
export function getEnvSources(): SourceConfig[] {
  const result = [...BUILTIN_VOD_SOURCES];
  const raw = process.env.DEFAULT_SOURCES;
  if (!raw || !raw.trim()) return result;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('必须是 JSON 数组');
    const seenUrls = new Set(result.map((source) => source.url.replace(/\\/+$/, '').toLowerCase()));

    parsed.forEach((item, i) => {
      if (typeof item !== 'object' || item === null) {
        throw new Error(`第 ${i + 1} 项不是对象`);
      }
      const { name, url, detail, isAdult } = item as Record<string, unknown>;
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error(`第 ${i + 1} 项缺少 name`);
      }
      if (typeof url !== 'string' || !/^https?:\\/\\//.test(url.trim())) {
        throw new Error(`第 ${i + 1} 项的 url 必须以 http:// 或 https:// 开头`);
      }
      const normalizedUrl = url.trim().replace(/\\/+$/, '');
      const dedupeKey = normalizedUrl.toLowerCase();
      if (seenUrls.has(dedupeKey)) return;
      seenUrls.add(dedupeKey);
      result.push({
        key: `env_custom_${i}`,
        name: name.trim(),
        url: normalizedUrl,
        detail: typeof detail === 'string' && detail.trim() ? detail.trim() : undefined,
        isAdult: isAdult === true,
      });
    });
    return result;
  } catch (err) {
    console.warn('[LibreTV] DEFAULT_SOURCES 解析失败，已忽略自定义源：', err instanceof Error ? err.message : err);
    return result;
  }
}
