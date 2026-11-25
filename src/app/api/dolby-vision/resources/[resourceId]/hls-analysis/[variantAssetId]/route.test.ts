import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalizeDolbyVisionRpuPayload } from '@/lib/dolby-vision/signed-rpu-envelope';

vi.mock('@/lib/api-guard', () => ({
  guardPrivateFeatureRequest: vi.fn(() => null),
}));
vi.mock('@/lib/auth', () => ({
  isAuthDisabled: vi.fn(() => false),
}));
vi.mock('@/lib/resource-collector-client', () => ({
  fetchDolbyVisionHlsAssembly: vi.fn(),
}));

import { isAuthDisabled } from '@/lib/auth';
import { fetchDolbyVisionHlsAssembly } from '@/lib/resource-collector-client';
import { POST } from './route';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const resourceId = 'hls-resource-1';
const variantAssetId = 'hls-variant-1';
const mediaBytes = Buffer.from('assembled fmp4 parser input');
const digest = createHash('sha256').update(mediaBytes).digest('hex');
const graphSha256 = 'c'.repeat(64);
const context = {
  scope: 'hls-fmp4' as const,
  resourceId,
  graphId: 'hls-root-1',
  graphSha256,
  rootAssetId: 'hls-root-1',
  variantAssetId,
  fragmentCount: 2,
  fragmentSequenceContinuity: 'sequential' as const,
  temporalContinuity: 'unknown' as const,
};
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
  input: 'assembled.hevc',
  inputSha256: 'd'.repeat(64),
  sourceMediaSha256: digest,
  rpuSha256: 'e'.repeat(64),
  inputKind: 'hevc',
  extractionScope: { track: null, frameLimit: null },
  notes: ['full-stream parser report'],
};

function envelope(overrides: Record<string, unknown> = {}) {
  const payload = {
    version: 1,
    keyId: 'dv-test-key',
    assetId: `hls:${createHash('sha256').update(`${resourceId}\\0${variantAssetId}`).digest('hex')}`,
    issuedAt: Math.floor(Date.now() / 1000) - 5,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    report,
    analysisContext: context,
    ...overrides,
  };
  const signature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(payload)), privateKey).toString('base64url');
  return { ...payload, signature };
}

function makeAssemblyResponse(overrides: Record<string, string> = {}) {
  return new Response(mediaBytes, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(mediaBytes.length),
      'X-DV-HLS-Graph-ID': overrides.graphId ?? context.graphId,
      'X-DV-HLS-Graph-SHA256': overrides.graphSha256 ?? graphSha256,
      'X-DV-HLS-Root-Asset-ID': context.rootAssetId,
      'X-DV-HLS-Variant-Asset-ID': variantAssetId,
      'X-DV-HLS-Assembled-SHA256': digest,
      'X-DV-HLS-Fragment-Count': '2',
      'X-DV-HLS-Fragment-Sequence-Continuity': 'sequential',
      'X-DV-HLS-Temporal-Continuity': 'unknown',
      'X-DV-RPU-Presence': 'unknown',
    },
  });
}

function makeRequest() {
  return new Request(`https://libretv.example/api/dolby-vision/resources/${resourceId}/hls-analysis/${variantAssetId}`, { method: 'POST' });
}

beforeEach(() => {
  vi.stubEnv('DV_PARSER_API_BASE', 'http://dolby-vision-parser:8788');
  vi.stubEnv('DV_SERVICE_TOKEN', 'server-parser-token');
  vi.stubEnv('DV_SIGNING_KEY_ID', 'dv-test-key');
  vi.stubEnv('DV_SIGNING_PUBLIC_KEY_PEM_B64', Buffer.from(publicKeyPem).toString('base64'));
  vi.mocked(isAuthDisabled).mockReturnValue(false);
  vi.mocked(fetchDolbyVisionHlsAssembly).mockResolvedValue(makeAssemblyResponse());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(fetchDolbyVisionHlsAssembly).mockReset();
});

describe('POST /api/dolby-vision/resources/[resourceId]/hls-analysis/[variantAssetId]', () => {
  it('streams collector-assembled bytes and returns graph-bound signed RPU evidence', async () => {
    const parserFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope()), { status: 200 }));
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      verified: true,
      analysisScope: 'hls-fmp4',
      resourceId,
      variantAssetId,
      assembledSha256: digest,
      graph: context,
      temporalContinuity: 'unknown',
      crossSegmentRpuContinuity: 'not-verified',
      evidence: { source: 'dovi_tool', rpuPresent: true, profile: 8 },
    });
    expect(fetchDolbyVisionHlsAssembly).toHaveBeenCalledWith(resourceId, variantAssetId, 16 * 60 * 1000);
    const [url, init] = parserFetch.mock.calls[0];
    expect(url).toBe('http://dolby-vision-parser:8788/v1/analyze');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer server-parser-token',
      'X-DV-Analysis-Scope': 'hls-fmp4',
      'X-DV-HLS-Graph-SHA256': graphSha256,
      'X-DV-Asset-SHA256': digest,
    });
    expect(init.body).toBeInstanceOf(ReadableStream);
    expect(init.duplex).toBe('half');
  });

  it('rejects missing or malformed graph provenance before parser invocation', async () => {
    vi.mocked(fetchDolbyVisionHlsAssembly).mockResolvedValue(makeAssemblyResponse({ graphSha256: 'bad' }));
    const parserFetch = vi.fn();
    vi.stubGlobal('fetch', parserFetch);
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    expect(response.status).toBe(409);
    expect(parserFetch).not.toHaveBeenCalled();
  });

  it('rejects a validly signed report for a different HLS graph', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope({
      analysisContext: { ...context, graphSha256: 'f'.repeat(64) },
    })), { status: 200 })));
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_HLS_SIGNED_EVIDENCE_REJECTED' });
  });

  it('fails closed when server authentication is disabled', async () => {
    vi.mocked(isAuthDisabled).mockReturnValue(true);
    const parserFetch = vi.fn();
    vi.stubGlobal('fetch', parserFetch);
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    expect(response.status).toBe(503);
    expect(fetchDolbyVisionHlsAssembly).not.toHaveBeenCalled();
    expect(parserFetch).not.toHaveBeenCalled();
  });
});
