import { NextResponse } from 'next/server';
import { checkUpstreamAllowed } from './ssrf';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_COLLECTOR_RESPONSE_BYTES = 4 * 1024 * 1024;

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

class CollectorResponseError extends Error {
  constructor(public readonly code: 'TOO_LARGE' | 'INVALID_JSON' | 'INVALID_UTF8') {
    super(code);
    this.name = 'CollectorResponseError';
  }
}

/** Enforce a byte ceiling while streaming; Content-Length is only an early-rejection hint. */
async function readCollectorJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_COLLECTOR_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new CollectorResponseError('TOO_LARGE');
  }
  if (!response.body) throw new CollectorResponseError('INVALID_JSON');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_COLLECTOR_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new CollectorResponseError('TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* stream already cancelled */ }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CollectorResponseError('INVALID_UTF8');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CollectorResponseError('INVALID_JSON');
  }
}

/**
 * Server-side proxy. Browser overrides are accepted only after the route's private-feature auth guard.
 * DNS validation blocks known private/reserved answers, but does not pin the resolved IP to fetch's socket;
 * DNS-rebinding resistance still requires the dedicated egress gateway.
 */
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
    const verdict = await checkUpstreamAllowed(config.base);
    if (!verdict.ok) {
      return NextResponse.json(
        { code: 'COLLECTOR_TARGET_REJECTED', error: 'Collector 地址未通过公网目标安全校验。' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const response = await fetch(config.base + path, {
      method: init.method ?? 'GET',
      ...(init.body !== undefined ? { body: init.body } : {}),
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      return NextResponse.json({ code: 'COLLECTOR_REDIRECT_REJECTED', error: 'Collector 返回了重定向，已按安全策略拒绝。' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    let payload: unknown;
    try {
      payload = await readCollectorJson(response);
    } catch (error) {
      const code = error instanceof CollectorResponseError ? error.code : 'INVALID_JSON';
      const tooLarge = code === 'TOO_LARGE';
      return NextResponse.json(
        {
          code: tooLarge ? 'COLLECTOR_RESPONSE_TOO_LARGE' : 'COLLECTOR_INVALID_RESPONSE',
          error: tooLarge ? 'Collector 响应超过 4 MB 上限。' : 'Collector 返回了非 JSON 或无效响应。',
        },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
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
