import type { SourceConfig } from './types';

/**
 * No external CMS provider is enabled by default.
 * Add only sources that have completed an explicit content and security review.
 */
export const BUILTIN_SOURCES: SourceConfig[] = [];

/**
 * Deployment-managed Apple CMS providers supplied through DEFAULT_SOURCES.
 * Supported metadata: key, name, url, detail, api, from, type, weight, isAdult.
 */
export function getEnvSources(): SourceConfig[] {
  const raw = process.env.DEFAULT_SOURCES;
  if (!raw || !raw.trim()) return [...BUILTIN_SOURCES];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('必须是 JSON 数组');
    const list: SourceConfig[] = parsed.map((item, i) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error(`第 ${i + 1} 项不是对象`);
      }
      const record = item as Record<string, unknown>;
      const { key: rawKey, name, url, detail, api, from, type, weight, isAdult } = record;
      const configuredKey = typeof rawKey === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(rawKey.trim())
        ? rawKey.trim()
        : `env_${i}`;
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error(`第 ${i + 1} 项缺少 name`);
      }
      const normalizedUrl = typeof url === 'string' ? url.trim() : '';
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(normalizedUrl);
      } catch {
        throw new Error(`第 ${i + 1} 项的 url 无效`);
      }
      if ((parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') || parsedUrl.username || parsedUrl.password) {
        throw new Error(`第 ${i + 1} 项的 url 必须是无凭据的 HTTP(S) 地址`);
      }
      const normalizedDetail = typeof detail === 'string' && detail.trim() ? detail.trim() : undefined;
      if (normalizedDetail) {
        const detailUrl = new URL(normalizedDetail);
        if ((detailUrl.protocol !== 'http:' && detailUrl.protocol !== 'https:') || detailUrl.username || detailUrl.password) {
          throw new Error(`第 ${i + 1} 项的 detail 必须是无凭据的 HTTP(S) 地址`);
        }
      }
      const normalizedApi = typeof api === 'string' && api.trim() ? api.trim() : undefined;
      if (normalizedApi) {
        const apiUrl = new URL(normalizedApi);
        if ((apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:') || apiUrl.username || apiUrl.password) {
          throw new Error(`第 ${i + 1} 项的 api 必须是无凭据的 HTTP(S) 地址`);
        }
      }
      if (type !== undefined && type !== 1) {
        throw new Error(`第 ${i + 1} 项的 type 目前只支持 1`);
      }
      if (weight !== undefined && (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 10000)) {
        throw new Error(`第 ${i + 1} 项的 weight 必须是 0 到 10000 的数字`);
      }
      if (from !== undefined && (typeof from !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(from))) {
        throw new Error(`第 ${i + 1} 项的 from 格式无效`);
      }
      return {
        key: configuredKey,
        name: name.trim(),
        url: normalizedUrl.replace(/\/+$/, ''),
        detail: normalizedDetail,
        api: normalizedApi,
        from: typeof from === 'string' ? from : undefined,
        type: typeof type === 'number' ? type : undefined,
        weight: typeof weight === 'number' ? weight : undefined,
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
