import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

describe('GET /api/img authentication', () => {
  const originalPassword = process.env.PASSWORD;
  const originalAuthDisabled = process.env.AUTH_DISABLED;

  beforeEach(() => {
    process.env.PASSWORD = 'test-password-123';
    delete process.env.AUTH_DISABLED;
  });

  afterEach(() => {
    if (originalPassword === undefined) delete process.env.PASSWORD;
    else process.env.PASSWORD = originalPassword;
    if (originalAuthDisabled === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = originalAuthDisabled;
  });

  it('rejects unauthenticated image proxy requests before fetching the target', async () => {
    const request = new NextRequest(
      'https://local.test/api/img?url=https%3A%2F%2Fimages.example%2Fposter.jpg',
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: '未登录' });
  });

  it('fails closed when the server password is not configured', async () => {
    delete process.env.PASSWORD;
    const request = new NextRequest(
      'https://local.test/api/img?url=https%3A%2F%2Fimages.example%2Fposter.jpg',
    );

    const response = await GET(request);

    expect(response.status).toBe(503);
  });

  it('rate limits repeated public image proxy requests per client', async () => {
    process.env.AUTH_DISABLED = 'true';
    const requestForClient = () => new NextRequest(
      'https://local.test/api/img?url=invalid',
      { headers: { 'cf-connecting-ip': '203.0.113.44' } },
    );

    for (let index = 0; index < 120; index += 1) {
      const response = await GET(requestForClient());
      expect(response.status).toBe(400);
    }

    const limited = await GET(requestForClient());
    expect(limited.status).toBe(429);
  });
});
