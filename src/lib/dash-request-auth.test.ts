import { describe, expect, it } from 'vitest';
import { createDashRequestAuthFilter } from './dash-request-auth';

describe('createDashRequestAuthFilter', () => {
  it('attaches authorization to the manifest origin and its child segments', () => {
    const filter = createDashRequestAuthFilter({
      headers: { Authorization: 'Bearer test-token', 'X-Media-Key': 'key-1' },
    }, 'https://media.example/path/manifest.mpd?sig=abc');
    const request = { uris: ['https://media.example/path/chunk-1.m4s'], headers: {} as Record<string, string>, allowCrossSiteCredentials: false };
    filter(request);
    expect(request.headers).toEqual({ Authorization: 'Bearer test-token', 'X-Media-Key': 'key-1' });
  });

  it('does not leak credentials to an untrusted cross-origin segment host', () => {
    const filter = createDashRequestAuthFilter({ headers: { Authorization: 'Bearer secret' } }, 'https://manifest.example/stream.mpd');
    const request = { uris: ['https://cdn-untrusted.example/chunk.m4s'], headers: {} as Record<string, string>, allowCrossSiteCredentials: false };
    filter(request);
    expect(request.headers).toEqual({});
    expect(request.allowCrossSiteCredentials).toBe(false);
  });

  it('allows explicitly trusted cross-origin segment hosts', () => {
    const filter = createDashRequestAuthFilter({
      headers: { Authorization: 'Bearer secret' },
      allowedOrigins: ['https://cdn.example/path-is-ignored'],
    }, 'https://manifest.example/stream.mpd');
    const request = { uris: ['https://cdn.example/chunk.m4s'], headers: {} as Record<string, string>, allowCrossSiteCredentials: false };
    filter(request);
    expect(request.headers.Authorization).toBe('Bearer secret');
  });

  it('fails closed for mixed trusted and untrusted fallback URLs', () => {
    const filter = createDashRequestAuthFilter({
      headers: { Authorization: 'Bearer secret' },
      allowedOrigins: ['https://cdn.example'],
    }, 'https://manifest.example/stream.mpd');
    const request = { uris: ['https://cdn.example/chunk.m4s', 'https://other.example/chunk.m4s'], headers: {} as Record<string, string>, allowCrossSiteCredentials: false };
    filter(request);
    expect(request.headers).toEqual({});
  });

  it('rejects browser-forbidden headers and CR/LF injection without rejecting ordinary letters r and n', () => {
    const filter = createDashRequestAuthFilter({
      headers: {
        Authorization: 'Bearer secret',
        Cookie: 'session=secret',
        Host: 'evil.example',
        'X-Bad': 'value' + String.fromCharCode(13, 10) + 'injected: yes',
        'X-Ordinary': 'renewal',
        'Sec-Fetch-Site': 'cross-site',
      },
    }, 'https://media.example/stream.mpd');
    const request = { uris: ['https://media.example/chunk.m4s'], headers: {} as Record<string, string>, allowCrossSiteCredentials: false };
    filter(request);
    expect(request.headers).toEqual({ Authorization: 'Bearer secret', 'X-Ordinary': 'renewal' });
  });

  it('refreshes provider headers only after an unauthorized retry is marked', async () => {
    let refreshCount = 0;
    const filter = createDashRequestAuthFilter({
      headers: { Authorization: 'Bearer expired' },
      refreshHeaders: async () => {
        refreshCount += 1;
        return { Authorization: 'Bearer renewed' };
      },
    }, 'https://media.example/stream.mpd');
    const request = { uris: ['https://media.example/chunk.m4s'], headers: {} as Record<string, string>, allowCrossSiteCredentials: false };
    filter.markUnauthorized();
    await filter(request);
    expect(refreshCount).toBe(1);
    expect(request.headers.Authorization).toBe('Bearer renewed');
  });

  it('coalesces concurrent unauthorized refreshes', async () => {
    let refreshCount = 0;
    let resolveRefresh: ((value: Record<string, string>) => void) | undefined;
    const filter = createDashRequestAuthFilter({
      refreshHeaders: () => {
        refreshCount += 1;
        return new Promise((resolve) => { resolveRefresh = resolve; });
      },
    }, 'https://media.example/manifest.mpd');
    filter.markUnauthorized();
    const first = { uris: ['https://media.example/a.m4s'], headers: {} as Record<string, string>, allowCrossSiteCredentials: false };
    const second = { uris: ['https://media.example/b.m4s'], headers: {} as Record<string, string>, allowCrossSiteCredentials: false };
    const firstPromise = filter(first);
    const secondPromise = filter(second);
    expect(refreshCount).toBe(1);
    resolveRefresh?.({ Authorization: 'Bearer fresh' });
    await Promise.all([firstPromise, secondPromise]);
    expect(first.headers.Authorization).toBe('Bearer fresh');
    expect(second.headers.Authorization).toBe('Bearer fresh');
  });

  it('enables cookie credentials only when explicitly requested', () => {
    const filter = createDashRequestAuthFilter({ withCredentials: true }, 'https://media.example/stream.mpd');
    const request = { uris: ['https://media.example/chunk.m4s'], headers: {} as Record<string, string>, allowCrossSiteCredentials: false };
    filter(request);
    expect(request.allowCrossSiteCredentials).toBe(true);
  });
});
