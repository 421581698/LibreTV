import { describe, expect, it } from 'vitest';
import { createDashRequestAuthFilter } from './dash-request-auth';

describe('createDashRequestAuthFilter', () => {
  it('attaches authorization to the manifest origin and its child segments', () => {
    const filter = createDashRequestAuthFilter({
      headers: { Authorization: 'Bearer test-token', 'X-Media-Key': 'key-1' },
    }, 'https://media.example/path/manifest.mpd?sig=abc');
    const request = {
      uris: ['https://media.example/path/chunk-1.m4s'],
      headers: {} as Record<string, string>,
      allowCrossSiteCredentials: false,
    };

    filter(request);

    expect(request.headers).toEqual({
      Authorization: 'Bearer test-token',
      'X-Media-Key': 'key-1',
    });
  });

  it('does not leak credentials to an untrusted cross-origin segment host', () => {
    const filter = createDashRequestAuthFilter({
      headers: { Authorization: 'Bearer secret' },
    }, 'https://manifest.example/stream.mpd');
    const request = {
      uris: ['https://cdn-untrusted.example/chunk.m4s'],
      headers: {} as Record<string, string>,
      allowCrossSiteCredentials: false,
    };

    filter(request);

    expect(request.headers).toEqual({});
    expect(request.allowCrossSiteCredentials).toBe(false);
  });

  it('allows explicitly trusted cross-origin segment hosts', () => {
    const filter = createDashRequestAuthFilter({
      headers: { Authorization: 'Bearer secret' },
      allowedOrigins: ['https://cdn.example/path-is-ignored'],
    }, 'https://manifest.example/stream.mpd');
    const request = {
      uris: ['https://cdn.example/chunk.m4s'],
      headers: {} as Record<string, string>,
      allowCrossSiteCredentials: false,
    };

    filter(request);

    expect(request.headers.Authorization).toBe('Bearer secret');
  });

  it('fails closed for mixed trusted and untrusted fallback URLs', () => {
    const filter = createDashRequestAuthFilter({
      headers: { Authorization: 'Bearer secret' },
      allowedOrigins: ['https://cdn.example'],
    }, 'https://manifest.example/stream.mpd');
    const request = {
      uris: ['https://cdn.example/chunk.m4s', 'https://other.example/chunk.m4s'],
      headers: {} as Record<string, string>,
      allowCrossSiteCredentials: false,
    };

    filter(request);

    expect(request.headers).toEqual({});
  });

  it('rejects browser-forbidden and malformed header values', () => {
    const filter = createDashRequestAuthFilter({
      headers: {
        Authorization: 'Bearer secret',
        Cookie: 'session=secret',
        Host: 'evil.example',
        'X-Bad': 'value\\r\\ninjected: yes',
        'Sec-Fetch-Site': 'cross-site',
      },
    }, 'https://media.example/stream.mpd');
    const request = {
      uris: ['https://media.example/chunk.m4s'],
      headers: {} as Record<string, string>,
      allowCrossSiteCredentials: false,
    };

    filter(request);

    expect(request.headers).toEqual({ Authorization: 'Bearer secret' });
  });

  it('enables cookie credentials only when explicitly requested', () => {
    const filter = createDashRequestAuthFilter({
      withCredentials: true,
    }, 'https://media.example/stream.mpd');
    const request = {
      uris: ['https://media.example/chunk.m4s'],
      headers: {} as Record<string, string>,
      allowCrossSiteCredentials: false,
    };

    filter(request);

    expect(request.allowCrossSiteCredentials).toBe(true);
  });
});
