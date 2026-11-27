import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectorRequest, fetchDolbyVisionRegistryAsset } from './resource-collector-client';
const dns=vi.hoisted(()=>({resolve4:vi.fn(),resolve6:vi.fn()}));
vi.mock('node:dns/promises',()=>dns);
dns.resolve4.mockResolvedValue(['8.8.8.8']);
dns.resolve6.mockResolvedValue([]);

afterEach(() => {
  dns.resolve4.mockResolvedValue(['8.8.8.8']);
  dns.resolve6.mockResolvedValue([]);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('fetchDolbyVisionRegistryAsset', () => {
  it('uses only server-side credentials and the fixed internal Compose collector origin', async () => {
    vi.stubEnv('DV_REGISTRY_API_BASE', 'http://scrapling-collector:8000');
    vi.stubEnv('SCRAPLING_API_TOKEN', 'server-registry-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('media', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchDolbyVisionRegistryAsset('dv_asset-123');
    expect(response?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://scrapling-collector:8000/v1/registry/media-assets/dv_asset-123/content',
      expect.objectContaining({
        headers: { Authorization: 'Bearer server-registry-token' },
        cache: 'no-store',
        redirect: 'manual',
      }),
    );
  });

  it('allows HTTPS registry origins but rejects arbitrary HTTP and browser-only credentials', async () => {
    vi.stubEnv('DV_REGISTRY_API_BASE', 'http://attacker.example:8000');
    vi.stubEnv('SCRAPLING_API_TOKEN', 'server-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchDolbyVisionRegistryAsset('dv_asset-123')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv('DV_REGISTRY_API_BASE', 'https://collector.example');
    vi.stubEnv('SCRAPLING_API_TOKEN', '');
    expect(await fetchDolbyVisionRegistryAsset('dv_asset-123')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed asset IDs before making a request', async () => {
    vi.stubEnv('DV_REGISTRY_API_BASE', 'https://collector.example');
    vi.stubEnv('SCRAPLING_API_TOKEN', 'server-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchDolbyVisionRegistryAsset('../secret')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('collectorRequest', () => {
  it.each([
    ['http://public.example', 'rejects non-TLS external collector endpoints'],
    ['http://scrapling-collector:8000', 'rejects Docker Compose HTTP endpoints at the HTTPS-only proxy boundary'],
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

  it('preserves upstream HTTP status and FastAPI detail for the connection diagnostic', async () => {
    vi.stubEnv('SCRAPLING_API_BASE', 'https://collector.example');
    vi.stubEnv('SCRAPLING_API_TOKEN', 'server-only-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: 'Crawling is disabled until host-level egress filtering is installed and verified',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })));

    const response = await collectorRequest('/health');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      detail: 'Crawling is disabled until host-level egress filtering is installed and verified',
    });
  });

  it('rejects non-JSON upstream health responses with a diagnostic code', async () => {
    vi.stubEnv('SCRAPLING_API_BASE', 'https://collector.example');
    vi.stubEnv('SCRAPLING_API_TOKEN', 'server-only-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>proxy error</html>', { status: 200 })));

    const response = await collectorRequest('/health');
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'COLLECTOR_INVALID_RESPONSE' });
  });

  it('does not allow caller-provided headers to override the collector bearer token', async () => {
    vi.stubEnv('SCRAPLING_API_BASE', 'https://collector.example');
    vi.stubEnv('SCRAPLING_API_TOKEN', 'server-only-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await collectorRequest('/v1/tasks', { headers: { Authorization: 'Bearer attacker-value' } });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer server-only-token');
  });

  it('rejects public-looking collector when DNS points to private IP',async()=>{
    vi.stubEnv('SCRAPLING_API_BASE','https://collector.example');
    vi.stubEnv('SCRAPLING_API_TOKEN','server-only-token');
    dns.resolve4.mockResolvedValue(['169.254.169.254']);
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);
    const response=await collectorRequest('/health');
    expect(response.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
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
