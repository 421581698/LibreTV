import type { SourceConfig } from './types';

/**
 * No external CMS provider is enabled by default.
 * Add only sources that have completed an explicit content and security review.
 */
export const BUILTIN_SOURCES: SourceConfig[] = [];

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
      if (typeof url !== 'string' || !/^https?:\/\//.test(url.trim())) {
        throw new Error(`第 ${i + 1} 项的 url 必须以 http:// 或 https:// 开头`);
      }
      return {
        key: configuredKey,
        name: name.trim(),
        url: url.trim().replace(/\/+$/, ''),
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
