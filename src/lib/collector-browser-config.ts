const STORAGE_KEY = 'libretv-scrapling-preview-config-v1';
export type ScraplingBrowserConfig = { base: string; token: string };

export function readScraplingConfig(): ScraplingBrowserConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { base: '', token: '' };
    const parsed = JSON.parse(raw) as Partial<ScraplingBrowserConfig>;
    return { base: typeof parsed.base === 'string' ? parsed.base : '', token: typeof parsed.token === 'string' ? parsed.token : '' };
  } catch {
    return { base: '', token: '' };
  }
}

export function normalizeScraplingBase(value: string): string {
  const parsed = new URL(value.trim());
  const hostname = parsed.hostname.toLowerCase();
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
  if (parsed.protocol !== 'https:' || parsed.port && parsed.port !== '443' || parsed.username || parsed.password ||
      parsed.pathname !== '/' && parsed.pathname !== '' || parsed.search || parsed.hash ||
      isIpLiteral || hostname === 'localhost' || !hostname.includes('.') ||
      /(^|\.)(local|internal|localhost|test|invalid)$/.test(hostname)) {
    throw new Error('Collector 地址必须是公网 HTTPS 域名，不能包含路径、端口、账号或查询参数。');
  }
  return parsed.origin;
}

export function saveScraplingConfig(config: ScraplingBrowserConfig): void {
  const base = normalizeScraplingBase(config.base);
  const token = config.token.trim();
  if (!token) throw new Error('请输入 SCRAPLING_API_TOKEN。');
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ base, token }));
}

export function clearScraplingConfig(): void {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
}

export function collectorFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const config = readScraplingConfig();
  const headers = new Headers(init.headers);
  if (config.base && config.token) {
    headers.set('X-Scrapling-Api-Base', config.base);
    headers.set('X-Scrapling-Api-Token', config.token);
  }
  return fetch(input, { ...init, headers, cache: 'no-store', credentials: 'same-origin' });
}
