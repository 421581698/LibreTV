import { beforeEach, describe, expect, it } from 'vitest';
import { POST as legacyChatPost } from './ai-chat/route';
import { POST as cancelChatPost } from './chat/cancel/route';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';

function request(path: string, body: unknown): Request {
  return new Request(`https://local.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('legacy AI endpoints require a session', () => {
  beforeEach(() => {
    process.env.PASSWORD = 'test-password-123';
    delete process.env.PROXY_SECRET;
    delete process.env.AUTH_DISABLED;
  });

  it('allows preview API requests when AUTH_DISABLED is explicitly enabled', async () => {
    process.env.AUTH_DISABLED = 'true';
    const response = await cancelChatPost(request('/api/chat/cancel', {}) as never);
    expect(response.status).toBe(400);
  });

  it('rejects unauthenticated legacy AI chat requests', async () => {
    const response = await legacyChatPost(request('/api/ai-chat', {
      messages: [{ role: 'user', content: 'hello' }],
    }) as never);
    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated chat cancellation requests', async () => {
    const response = await cancelChatPost(request('/api/chat/cancel', {
      requestId: 'req_test_123',
    }) as never);
    expect(response.status).toBe(401);
  });

  it('treats malformed session cookies as unauthenticated instead of throwing', async () => {
    const response = await legacyChatPost(new Request('https://local.test/api/ai-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'ltv_session=%E0%A4%A',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    }) as never);
    expect(response.status).toBe(401);
  });

  it('returns 503 when the server password is not configured', async () => {
    delete process.env.PASSWORD;
    const response = await legacyChatPost(request('/api/ai-chat', {
      messages: [{ role: 'user', content: 'hello' }],
    }) as never);
    expect(response.status).toBe(503);
  });
});


describe('public preview Collector access', () => {
  beforeEach(() => {
    process.env.AUTH_DISABLED = 'true';
    delete process.env.SCRAPLING_API_BASE;
    delete process.env.SCRAPLING_API_TOKEN;
  });

  it('does not require a website password when Collector credentials are configured in browser settings', () => {
    const req = new Request('https://local.test/api/resource-collector', {
      headers: {
        'x-scrapling-api-base': 'https://collector.example',
        'x-scrapling-api-token': 'collector-access-token',
      },
    });
    expect(guardPrivateFeatureRequest(req)).toBeNull();
  });

  it('allows server-configured Collector credentials without enabling the website password', () => {
    process.env.SCRAPLING_API_BASE = 'https://collector.example';
    process.env.SCRAPLING_API_TOKEN = 'server-only-token';
    expect(guardPrivateFeatureRequest(new Request('https://local.test/api/resource-collector'))).toBeNull();
  });

  it('returns a setup hint instead of a website-password warning when Collector is not configured', async () => {
    const response = guardPrivateFeatureRequest(new Request('https://local.test/api/resource-collector'));
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      code: 'COLLECTOR_NOT_CONFIGURED',
      error: expect.stringContaining('网站无需访问密码'),
    });
  });
});
