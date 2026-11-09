import { NextResponse } from 'next/server';

const DEFAULT_TIMEOUT_MS = 20_000;

function collectorConfig() {
  const rawBase = process.env.SCRAPLING_API_BASE?.trim();
  const token = process.env.SCRAPLING_API_TOKEN?.trim();
  if (!rawBase || !token) return null;

  try {
    const parsed = new URL(rawBase);
    const internalDocker =
      parsed.protocol === 'http:' &&
      parsed.hostname === 'scrapling-collector' &&
      (parsed.port === '' || parsed.port === '8000');
    const publicHttps =
      parsed.protocol === 'https:' &&
      (parsed.port === '' || parsed.port === '443');

    if (
      (!internalDocker && !publicHttps) ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== '' && parsed.pathname !== '/') ||
      parsed.search ||
      parsed.hash
    ) return null;

    return { base: parsed.origin, token };
  } catch {
    return null;
  }
}

/** Server-only authenticated client. Never expose the collector token to browser code. */
export async function collectorRequest(
  path: string,
  init: Pick<RequestInit, 'method' | 'body' | 'headers'> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const config = collectorConfig();
  if (!config) {
    return NextResponse.json(
      { error: 'Scrapling 服务未配置或地址不符合安全要求。请检查服务端 SCRAPLING_API_BASE 与 SCRAPLING_API_TOKEN。' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const response = await fetch(config.base + path, {
      method: init.method ?? 'GET',
      ...(init.body !== undefined ? { body: init.body } : {}),
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({ error: 'Collector returned an invalid response.' }));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: '无法连接 Scrapling 采集服务，请检查服务状态和网络配置。' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
