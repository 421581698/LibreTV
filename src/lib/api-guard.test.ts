import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, signSession } from './auth';
import { guardPrivateFeatureRequest } from './api-guard';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('guardPrivateFeatureRequest', () => {
  it('blocks private feature APIs when public preview auth bypass is enabled', () => {
    vi.stubEnv('AUTH_DISABLED', 'true');
    vi.stubEnv('PASSWORD', 'preview-password');

    const response = guardPrivateFeatureRequest(new Request('https://preview.example/api/resource-collector'));
    expect(response?.status).toBe(403);
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
  });

  it('requires a login session when normal authentication is enabled', () => {
    vi.stubEnv('AUTH_DISABLED', 'false');
    vi.stubEnv('PASSWORD', 'test-password');

    const response = guardPrivateFeatureRequest(new Request('https://app.example/api/resource-collector'));
    expect(response?.status).toBe(401);
  });

  it('allows a valid password-protected session', () => {
    vi.stubEnv('AUTH_DISABLED', 'false');
    vi.stubEnv('PASSWORD', 'test-password');
    const { token } = signSession();

    const response = guardPrivateFeatureRequest(new Request('https://app.example/api/resource-collector', {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    }));
    expect(response).toBeNull();
  });
});
