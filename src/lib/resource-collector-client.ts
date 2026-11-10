import { NextResponse } from 'next/server';

const DEFAULT_TIMEOUT_MS = 20_000;

function validCollectorBase(rawBase: string): string | null {
  try {
    const parsed = new URL(rawBase.trim());
    const hostname = parsed.hostname.toLowerCase();
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
    if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443') ||
      parsed.username || parsed.password || (parsed.pathname !== '' && parsed.pathname !== '/') ||
      parsed.search || parsed.hash || isIpLiteral || hostname === 'localhost' ||
      !hostname.includes('.') || /(^|\.)(local|internal|localhost|test|invalid)$/.test(hostname)) return null;
    return parsed.origin;
  } catch { return null; }
}

function collectorConfig(request?: Request) {
  const browserBase = request?.headers.get('x-scrapling-api-base')?.trim() ?? '';
  const browserToken = request?.headers.get('x-scrapling-api-token')?.trim() ?? '';
  if (browserBase || browserToken) {
    const base = validCollectorBase(browserBase);
    if (!base || !browserToken || browserToken.length > 4096) return null;
    return { base, token: browserToken };
  }

  const base = validCollectorBase(process.env.SCRAPLING_API_BASE ?? '');
  const token = process.env.SCRAPLING_API_TOKEN?.trim();
  return base && token ? { base, token } : null;
}

/** Server-side proxy. Browser overrides are accepted only after the route's private-feature auth guard. */
export async function collectorRequest(
  path: string,
  init: Pick<RequestInit, 'method' | 'body' | 'headers'> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  request?: Request,
) {
  const config = collectorConfig(request);
  if (!config) {
    return NextResponse.json(
      { error: 'Scrapling 配置缺失或不符合安全要求。请检查本机设置中的 HTTPS 地址和 Token，或服务端环境变量。' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    const response = await fetch(config.base + path, {
      method: init.method ?? 'GET',
      ...(init.body !== undefined ? { body: init.body } : {}),
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json({ code: 'COLLECTOR_REDIRECT_REJECTED', error: 'Collector 返回了重定向，已按安全策略拒绝。' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const payload = await response.json().catch(() => null);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json(
        { code: 'COLLECTOR_INVALID_RESPONSE', error: 'Collector 返回了非 JSON 或无效响应。' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(payload, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (reason) {
    const timedOut = reason instanceof Error && reason.name === 'TimeoutError';
    return NextResponse.json(
      { code: timedOut ? 'COLLECTOR_TIMEOUT' : 'COLLECTOR_UNREACHABLE', error: timedOut ? '连接 Scrapling 采集服务超时。请检查公网地址、网络出口和服务响应时间。' : '无法连接 Scrapling 采集服务。请检查公网地址、TLS 证书和网络出口。' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
