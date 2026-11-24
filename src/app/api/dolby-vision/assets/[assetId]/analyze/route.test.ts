import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalizeDolbyVisionRpuPayload } from '@/lib/dolby-vision/signed-rpu-envelope';

vi.mock('@/lib/api-guard', () => ({
  guardPrivateFeatureRequest: vi.fn(() => null),
}));
vi.mock('@/lib/resource-collector-client', () => ({
  fetchDolbyVisionRegistryAsset: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  isAuthDisabled: vi.fn(() => false),
}));

import { fetchDolbyVisionRegistryAsset } from '@/lib/resource-collector-client';
import { isAuthDisabled } from '@/lib/auth';
import { POST } from './route';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const assetId = 'dv_asset-123';
const mediaBytes = Buffer.from('test-media-bytes');
const digest = createHash('sha256').update(mediaBytes).digest('hex');
const now = Math.floor(Date.now() / 1000);
const report = {
  source: 'dovi_tool',
  parserVersion: '2.3.4',
  verified: true,
  rpuPresent: true,
  profile: 8,
  profiles: [8],
  frameCount: 240,
  metadataLevels: [1, 2, 5, 6],
  metadataLevelFrameCounts: { '1': 240, '2': 240, '5': 1, '6': 1 },
  input: 'media.hevc',
  inputSha256: digest,
  sourceMediaSha256: digest,
  rpuSha256: 'b'.repeat(64),
  inputKind: 'hevc',
  extractionScope: { track: null, frameLimit: null },
  notes: ['full-stream parser report'],
};

function signedEnvelope(overrides: Record<string, unknown> = {}) {
  const payload = {
    version: 1,
    keyId: 'dv-test-key',
    assetId,
    issuedAt: now - 5,
    expiresAt: now + 3600,
    report,
    ...overrides,
  };
  const signature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(payload)), privateKey).toString('base64url');
  return { ...payload, signature };
}

function makeRegistryResponse(overrides: Record<string, string> = {}) {
  const bytes = mediaBytes;
  const hash = overrides.digest ?? digest;
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(bytes.length),
      'X-DV-Asset-ID': overrides.assetId ?? assetId,
      'X-DV-Asset-SHA256': hash,
      ETag: `"${hash}"`,
    },
  });
}

function makeRequest() {
  return new Request(`https://libretv.example/api/dolby-vision/assets/${assetId}/analyze`, { method: 'POST' });
}

beforeEach(() => {
  vi.stubEnv('DV_PARSER_API_BASE', 'http://dolby-vision-parser:8788');
  vi.stubEnv('DV_SERVICE_TOKEN', 'server-parser-token');
  vi.stubEnv('DV_SIGNING_KEY_ID', 'dv-test-key');
  vi.stubEnv('DV_SIGNING_PUBLIC_KEY_PEM_B64', Buffer.from(publicKeyPem).toString('base64'));
  vi.stubEnv('DV_MAX_UPLOAD_BYTES', '1048576');
  vi.stubEnv('DV_ANALYSIS_TIMEOUT_MS', '60000');
  vi.mocked(isAuthDisabled).mockReturnValue(false);
  vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(makeRegistryResponse());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(fetchDolbyVisionRegistryAsset).mockReset();
});

describe('POST /api/dolby-vision/assets/[assetId]/analyze', () => {
  it('streams only the registry-bound object to the parser and returns verified signed evidence', async () => {
    const parserFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(signedEnvelope()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(makeRequest(), { params: Promise.resolve({ assetId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      verified: true,
      assetId,
      keyId: 'dv-test-key',
      sourceHashBinding: 'matched',
      evidence: { source: 'dovi_tool', rpuPresent: true, profile: 8 },
    });
    expect(parserFetch).toHaveBeenCalledTimes(1);
    const [url, init] = parserFetch.mock.calls[0];
    expect(url).toBe('http://dolby-vision-parser:8788/v1/analyze');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer server-parser-token',
      'Content-Type': 'application/octet-stream',
      'X-DV-Asset-ID': assetId,
      'X-DV-Asset-SHA256': digest,
      'X-DV-Source-Content-Type': 'video/mp4',
    });
    expect(init.body).toBeInstanceOf(ReadableStream);
    expect(init.duplex).toBe('half');
  });

  it('rejects a signed envelope for a different asset or digest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(
      signedEnvelope({ report: { ...report, sourceMediaSha256: 'c'.repeat(64) } }),
    ), { status: 200 })));

    const response = await POST(makeRequest(), { params: Promise.resolve({ assetId }) });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_SIGNED_EVIDENCE_REJECTED' });
  });

  it('rejects media larger than the configured parser upload limit', async () => {
    const bytes = Buffer.alloc(1_048_577, 1);
    vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(bytes.length),
        'X-DV-Asset-ID': assetId,
        'X-DV-Asset-SHA256': digest,
        ETag: `"${digest}"`,
      },
    }));
    const parserFetch = vi.fn();
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(makeRequest(), { params: Promise.resolve({ assetId }) });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_MEDIA_TOO_LARGE' });
    expect(parserFetch).not.toHaveBeenCalled();
  });

  it('rejects an unbound registry response before contacting the parser', async () => {
    vi.mocked(fetchDolbyVisionRegistryAsset).mockResolvedValue(makeRegistryResponse({ assetId: 'another-asset' }));
    const parserFetch = vi.fn();
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(makeRequest(), { params: Promise.resolve({ assetId }) });
    expect(response.status).toBe(409);
    expect(parserFetch).not.toHaveBeenCalled();
  });

  it('does not allow public-preview bypass headers to invoke server-credential analysis', async () => {
    vi.mocked(isAuthDisabled).mockReturnValue(true);
    const parserFetch = vi.fn();
    vi.stubGlobal('fetch', parserFetch);

    const request = new Request(`https://libretv.example/api/dolby-vision/assets/${assetId}/analyze`, {
      method: 'POST',
      headers: {
        'x-scrapling-api-base': 'https://attacker.example',
        'x-scrapling-api-token': 'attacker-token',
      },
    });
    const response = await POST(request, { params: Promise.resolve({ assetId }) });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_ANALYSIS_AUTH_REQUIRED' });
    expect(parserFetch).not.toHaveBeenCalled();
    expect(fetchDolbyVisionRegistryAsset).not.toHaveBeenCalled();
  });

  it('fails closed when parser verification settings are missing', async () => {
    vi.stubEnv('DV_SIGNING_PUBLIC_KEY_PEM_B64', '');
    const parserFetch = vi.fn();
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(makeRequest(), { params: Promise.resolve({ assetId }) });
    expect(response.status).toBe(503);
    expect(parserFetch).not.toHaveBeenCalled();
  });
});
