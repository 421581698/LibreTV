import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectorRequest } from './resource-collector-client';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('collectorRequest', () => {
  it.each([
    ['http://public.example', 'rejects non-TLS external collector endpoints'],
    ['https://user:pass@collector.example', 'rejects credentials in the collector URL'],
    ['https://collector.example/private-path', 'rejects collector URL path prefixes'],
    ['https://collector.example?token=leak', 'rejects query strings in the collector URL'],
    ['https://collector.example:8443', 'rejects non-standard public collector ports'],
  ])('%s: %s', async (base) => {
    vi.stubEnv('SCRAPLING_API_BASE', base);
    vi.stubEnv('SCRAPLING_API_TOKEN', 'server-only-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await collectorRequest('/v1/tasks');
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows the documented HTTPS service origin and adds the bearer token server-side', async () => {
    vi.stubEnv('SCRAPLING_API_BASE', 'https://collector.example/');
    vi.stubEnv('SCRAPLING_API_TOKEN', 'server-only-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await collectorRequest('/v1/tasks');
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://collector.example/v1/tasks', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer server-only-token' }),
      cache: 'no-store',
    }));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('allows only the documented Docker Compose internal HTTP service', async () => {
    vi.stubEnv('SCRAPLING_API_BASE', 'http://scrapling-collector:8000');
    vi.stubEnv('SCRAPLING_API_TOKEN', 'server-only-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await collectorRequest('/v1/tasks');
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('http://scrapling-collector:8000/v1/tasks', expect.any(Object));
  });

  it('fails closed when either server-side setting is missing', async () => {
    vi.stubEnv('SCRAPLING_API_BASE', 'https://collector.example');
    vi.stubEnv('SCRAPLING_API_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await collectorRequest('/v1/tasks');
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
