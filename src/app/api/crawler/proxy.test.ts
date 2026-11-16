import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './[...path]/route';

const context = (path: string[]) => ({
  params: Promise.resolve({ path }),
});

describe('crawler engine proxy', () => {
  beforeEach(() => {
    process.env.AUTH_DISABLED = 'true';
    process.env.SCRAPLING_ENGINE_URL = 'https://engine.example.test/base';
    process.env.SCRAPLING_ENGINE_API_KEY = 'test-engine-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AUTH_DISABLED;
    delete process.env.PASSWORD;
    delete process.env.SCRAPLING_ENGINE_URL;
    delete process.env.SCRAPLING_ENGINE_API_KEY;
  });

  it('forwards allowed requests through the server-side engine credential', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, candidates: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('https://local.test/api/crawler/candidates?limit=10'),
      context(['candidates']),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe(
      'https://engine.example.test/base/v1/candidates?limit=10',
    );
    expect(new Headers(init?.headers).get('X-API-Key')).toBe('test-engine-key');
  });

  it('rejects paths outside the explicit API allowlist', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('https://local.test/api/crawler/admin/secrets'),
      context(['admin', 'secrets']),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a LibreTV session when authentication is enabled', async () => {
    delete process.env.AUTH_DISABLED;
    process.env.PASSWORD = 'test-password-123';
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('https://local.test/api/crawler/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: [] }),
      }),
      context(['workflows']),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the engine service credentials are missing', async () => {
    delete process.env.SCRAPLING_ENGINE_API_KEY;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('https://local.test/api/crawler/candidates'),
      context(['candidates']),
    );

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
