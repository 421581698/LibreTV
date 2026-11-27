import { NextResponse } from 'next/server';
import { fetchVerifiedPublicSingleHop } from './fetch-utils';

const DEFAULT_TIMEOUT_MS = 20_000;

/** Only this exact fixed Compose service may use the authorized private network. */
function fetchCollectorOneHop(base:string,path:string,init:Omit<RequestInit,'redirect'>):Promise<Response> {
  const url=base+path;
  return base==='http://scrapling-collector:8000'
    ? fetch(url,{...init,redirect:'manual'})
    : fetchVerifiedPublicSingleHop(url,init);
}

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

function trustedServerRegistryBase(): string | null {
  const raw = (process.env.DV_REGISTRY_API_BASE ?? process.env.SCRAPLING_API_BASE ?? '').trim();
  if (!raw) return null;
  const httpsBase = validCollectorBase(raw);
  if (httpsBase) return httpsBase;
  // Plain HTTP is allowed only for the fixed Docker Compose service name on
  // its private collector network; arbitrary HTTP hosts remain rejected.
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' || parsed.hostname !== 'scrapling-collector' ||
        parsed.port !== '8000' || parsed.username || parsed.password ||
        (parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Server-only byte fetch. It never reads browser-supplied collector credentials. */
export async function fetchDolbyVisionRegistryAsset(
  assetId: string,
  timeoutMs = 20_000,
  rangeHeader?: string,
): Promise<Response | null> {
  if (!/^[A-Za-z0-9:_-]{1,200}$/.test(assetId)) return null;
  if (rangeHeader !== undefined && rangeHeader.length > 128) return null;
  const base = trustedServerRegistryBase();
  const token = process.env.SCRAPLING_API_TOKEN?.trim();
  if (!base || !token) return null;
  return fetchCollectorOneHop(base,`/v1/registry/media-assets/${encodeURIComponent(assetId)}/content`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Read graph through the fixed server-only collector identity; ignore browser overrides. */
export async function fetchDolbyVisionHlsGraph(resourceId: string): Promise<Response | null> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(resourceId)) return null;
  const base = trustedServerRegistryBase();
  const token = process.env.SCRAPLING_API_TOKEN?.trim();
  if (!base || !token) return null;
  return fetchCollectorOneHop(base,`/v1/registry/resources/${encodeURIComponent(resourceId)}/hls-graph`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store', signal: AbortSignal.timeout(5000),
  });
}

/** Server-only HLS parser-input fetch. It always uses trusted server credentials, never browser overrides. */
export async function fetchDolbyVisionHlsAssembly(
  resourceId: string,
  variantAssetId: string,
  timeoutMs = 15 * 60 * 1000,
): Promise<Response | null> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(resourceId) ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(variantAssetId)) return null;
  const base = trustedServerRegistryBase();
  const token = process.env.SCRAPLING_API_TOKEN?.trim();
  if (!base || !token) return null;
  return fetchCollectorOneHop(
    base,`/v1/registry/resources/${encodeURIComponent(resourceId)}/hls-assembly/${encodeURIComponent(variantAssetId)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
}

/** Server-only fetch for one immutable HLS fragment parser input. */
export async function fetchDolbyVisionHlsAssemblySegment(
  resourceId: string,
  variantAssetId: string,
  fragmentOrdinal: number,
  timeoutMs = 15 * 60 * 1000,
): Promise<Response | null> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(resourceId) ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(variantAssetId) ||
      !Number.isSafeInteger(fragmentOrdinal) || fragmentOrdinal < 0 || fragmentOrdinal >= 10_000) return null;
  const base = trustedServerRegistryBase();
  const token = process.env.SCRAPLING_API_TOKEN?.trim();
  if (!base || !token) return null;
  return fetchCollectorOneHop(
    base,`/v1/registry/resources/${encodeURIComponent(resourceId)}/hls-assembly/${encodeURIComponent(variantAssetId)}/segments/${fragmentOrdinal}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
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
    const response = await fetchVerifiedPublicSingleHop(config.base + path, {
      method: init.method ?? 'GET',
      ...(init.body !== undefined ? { body: init.body } : {}),
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
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
