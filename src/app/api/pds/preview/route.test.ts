import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const state = vi.hoisted(() => ({
  result: { status: 'ready' as const, renditions: [{ templateId: '264_1080p', url: 'https://media.example/movie.m3u8', category: 'quick_video' as const }] },
  error: null as Error | null,
  guarded: null as Response | null,
  input: null as unknown,
}));

vi.mock('@/lib/api-guard', () => ({
  guardRequest: vi.fn(() => state.guarded),
}));

vi.mock('@/lib/pds-video-preview', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pds-video-preview')>('@/lib/pds-video-preview');
  return {
    ...actual,
    getPdsVideoPreviewPlayInfo: vi.fn(async (input: unknown) => {
      state.input = input;
      if (state.error) throw state.error;
      return state.result;
    }),
  };
});

function post(body: unknown) {
  return new Request('https://local.test/api/pds/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.error = null;
  state.guarded = null;
  state.input = null;
});

describe('POST /api/pds/preview', () => {
  it('requires the existing LibreTV session guard', async () => {
    state.guarded = Response.json({ error: '未登录' }, { status: 401 });
    const response = await POST(post({}));
    expect(response.status).toBe(401);
  });

  it('validates inputs and returns the signed HLS rendition without caching', async () => {
    const response = await POST(post({
      domainId: 'demo-domain',
      fileId: 'file-1',
      driveId: 'drive-1',
      accessToken: 'private-access-token',
      category: 'quick_video',
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      status: 'ready',
      renditions: [{ url: 'https://media.example/movie.m3u8' }],
    });
    expect(state.input).toMatchObject({ domainId: 'demo-domain', accessToken: 'private-access-token' });
  });

  it('rejects malformed auth combinations before contacting PDS', async () => {
    const response = await POST(post({
      domainId: 'demo-domain',
      fileId: 'file-1',
      driveId: 'drive-1',
    }));
    expect(response.status).toBe(400);
    expect(state.input).toBeNull();
  });

  it('returns retryable pending results from PDS', async () => {
    state.result = { status: 'pending', retryAfterSeconds: 3 };
    const response = await POST(post({
      domainId: 'demo-domain',
      fileId: 'file-1',
      driveId: 'drive-1',
      accessToken: 'token',
    }));
    await expect(response.json()).resolves.toEqual({ status: 'pending', retryAfterSeconds: 3 });
  });

  it('maps provider authorization failures without exposing credentials', async () => {
    const { PdsPreviewError } = await import('@/lib/pds-video-preview');
    state.error = new PdsPreviewError('expired', 'UNAUTHORIZED', 401);
    const response = await POST(post({
      domainId: 'demo-domain',
      fileId: 'file-1',
      driveId: 'drive-1',
      accessToken: 'do-not-return-this',
    }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(JSON.stringify(body)).not.toContain('do-not-return-this');
  });
});
