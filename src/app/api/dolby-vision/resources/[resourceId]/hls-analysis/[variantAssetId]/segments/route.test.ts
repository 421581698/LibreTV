import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalizeDolbyVisionRpuPayload } from '@/lib/dolby-vision/signed-rpu-envelope';

vi.mock('@/lib/api-guard', () => ({ guardPrivateFeatureRequest: vi.fn(() => null) }));
vi.mock('@/lib/auth', () => ({ isAuthDisabled: vi.fn(() => false) }));
vi.mock('@/lib/resource-collector-client', () => ({ fetchDolbyVisionHlsAssemblySegment: vi.fn() }));

import { isAuthDisabled } from '@/lib/auth';
import { fetchDolbyVisionHlsAssemblySegment } from '@/lib/resource-collector-client';
import { POST } from './route';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const resourceId = 'hls-resource-1';
const variantAssetId = 'hls-variant-1';
const graph = {
  graphId: 'hls-root-1',
  graphSha256: 'c'.repeat(64),
  rootAssetId: 'hls-root-1',
  variantAssetId,
  fragmentCount: 2,
};
const fragmentBytes = [Buffer.from('init plus fragment zero'), Buffer.from('init plus fragment one')];
const fragments = fragmentBytes.map((bytes, ordinal) => ({
  fragmentAssetId: `segment:${ordinal + 1}`,
  fragmentSha256: (ordinal === 0 ? 'd' : 'e').repeat(64),
  initializationAssetId: 'init:001',
  initializationSha256: 'a'.repeat(64),
  assembledSegmentSha256: createHash('sha256').update(bytes).digest('hex'),
  fragmentSequenceNumber: ordinal + 1,
  decodeTime: ordinal * 9600,
  sampleDuration: 9600,
  sampleCount: 240,
  timescale: 1000,
}));
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
  input: 'segment.hevc',
  inputSha256: 'b'.repeat(64),
  sourceMediaSha256: '',
  rpuSha256: 'f'.repeat(64),
  inputKind: 'hevc',
  extractionScope: { track: null, frameLimit: null },
  notes: ['full fragment parser report'],
};

function makeEnvelope(ordinal: number) {
  const fragment = fragments[ordinal];
  const analysisContext = {
    scope: 'hls-fmp4-segment' as const,
    resourceId,
    ...graph,
    fragmentSequenceContinuity: 'sequential' as const,
    temporalContinuity: 'contiguous' as const,
    fragmentOrdinal: ordinal,
    ...fragment,
  };
  const payload = {
    version: 1,
    keyId: 'dv-test-key',
    assetId: fragment.fragmentAssetId,
    issuedAt: Math.floor(Date.now() / 1000) - 5,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    report: { ...report, sourceMediaSha256: fragment.assembledSegmentSha256 },
    analysisContext,
  };
  const signature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(payload)), privateKey).toString('base64url');
  return { ...payload, signature };
}

function makeFragmentResponse(ordinal: number) {
  const fragment = fragments[ordinal];
  const bytes = fragmentBytes[ordinal];
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(bytes.length),
      'X-DV-Asset-ID': fragment.fragmentAssetId,
      'X-DV-Asset-SHA256': fragment.assembledSegmentSha256,
      'X-DV-Analysis-Scope': 'hls-fmp4-segment',
      'X-DV-HLS-RESOURCE-ID': resourceId,
      'X-DV-HLS-GRAPH-ID': graph.graphId,
      'X-DV-HLS-GRAPH-SHA256': graph.graphSha256,
      'X-DV-HLS-ROOT-ASSET-ID': graph.rootAssetId,
      'X-DV-HLS-VARIANT-ASSET-ID': graph.variantAssetId,
      'X-DV-HLS-FRAGMENT-COUNT': String(graph.fragmentCount),
      'X-DV-HLS-FRAGMENT-SEQUENCE-CONTINUITY': 'sequential',
      'X-DV-HLS-TEMPORAL-CONTINUITY': 'contiguous',
      'X-DV-HLS-FRAGMENT-ORDINAL': String(ordinal),
      'X-DV-HLS-FRAGMENT-ASSET-ID': fragment.fragmentAssetId,
      'X-DV-HLS-FRAGMENT-SHA256': fragment.fragmentSha256,
      'X-DV-HLS-INITIALIZATION-ASSET-ID': fragment.initializationAssetId,
      'X-DV-HLS-INITIALIZATION-SHA256': fragment.initializationSha256,
      'X-DV-HLS-ASSEMBLED-SEGMENT-SHA256': fragment.assembledSegmentSha256,
      'X-DV-HLS-FRAGMENT-SEQUENCE-NUMBER': String(fragment.fragmentSequenceNumber),
      'X-DV-HLS-DECODE-TIME': String(fragment.decodeTime),
      'X-DV-HLS-SAMPLE-DURATION': String(fragment.sampleDuration),
      'X-DV-HLS-SAMPLE-COUNT': String(fragment.sampleCount),
      'X-DV-HLS-TIMESCALE': String(fragment.timescale),
    },
  });
}

beforeEach(() => {
  vi.stubEnv('DV_PARSER_API_BASE', 'http://dolby-vision-parser:8788');
  vi.stubEnv('DV_SERVICE_TOKEN', 'server-parser-token');
  vi.stubEnv('DV_SIGNING_KEY_ID', 'dv-test-key');
  vi.stubEnv('DV_SIGNING_PUBLIC_KEY_PEM_B64', Buffer.from(publicKeyPem).toString('base64'));
  vi.mocked(isAuthDisabled).mockReturnValue(false);
  vi.mocked(fetchDolbyVisionHlsAssemblySegment).mockImplementation(async (_resource, _variant, ordinal) =>
    Number.isInteger(ordinal) && ordinal >= 0 && ordinal < fragments.length
      ? makeFragmentResponse(ordinal)
      : new Response(null, { status: 404 }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(fetchDolbyVisionHlsAssemblySegment).mockReset();
});

describe('POST HLS fragment-set analysis', () => {
  it('parses and verifies every signed fragment against graph identity and contiguous timing', async () => {
    const parserFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeEnvelope(0)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeEnvelope(1)), { status: 200 }));
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(new Request('https://libretv.example/segments', { method: 'POST' }), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    const body = await response.json();

    if (response.status !== 200) throw new Error(`HLS segment route returned ${response.status}: ${JSON.stringify(body)}`);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      verified: true,
      analysisScope: 'hls-fmp4-segment-set',
      resourceId,
      variantAssetId,
      segmentCount: 2,
      totalRpuFrameCount: 480,
      timelineContinuity: 'contiguous',
      rpuProfileContinuity: 'consistent',
      rpuFrameAlignment: 'one-rpu-per-video-sample',
      rpuSemanticContinuity: 'not-established',
    });
    expect(fetchDolbyVisionHlsAssemblySegment).toHaveBeenCalledTimes(2);
    expect(parserFetch).toHaveBeenCalledTimes(2);
    const firstParserHeaders = new Headers(parserFetch.mock.calls[0][1].headers);
    const secondParserHeaders = new Headers(parserFetch.mock.calls[1][1].headers);
    expect(firstParserHeaders.get('X-DV-Analysis-Scope')).toBe('hls-fmp4-segment');
    expect(firstParserHeaders.get('X-DV-HLS-Fragment-Ordinal')).toBe('0');
    expect(firstParserHeaders.get('X-DV-HLS-Decode-Time')).toBe('0');
    expect(secondParserHeaders.get('X-DV-HLS-Fragment-Ordinal')).toBe('1');
    expect(secondParserHeaders.get('X-DV-HLS-Decode-Time')).toBe('9600');
  });

  it('rejects a fragment whose parser signature belongs to a different graph', async () => {
    const bad = makeEnvelope(1);
    bad.analysisContext.graphSha256 = '9'.repeat(64);
    const signature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload((({ signature: _s, ...payload }) => payload)(bad))), privateKey).toString('base64url');
    const parserFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeEnvelope(0)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...bad, signature }), { status: 200 }));
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(new Request('https://libretv.example/segments', { method: 'POST' }), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    const body = await response.json();
    if (response.status !== 502) throw new Error(`HLS segment signature route returned ${response.status}: ${JSON.stringify(body)}`);
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: 'DV_HLS_FRAGMENT_SIGNED_EVIDENCE_REJECTED' });
  });

  it('rejects a missing second fragment without claiming full-set verification', async () => {
    vi.mocked(fetchDolbyVisionHlsAssemblySegment).mockImplementation(async (_resource, _variant, ordinal) =>
      ordinal === 0 ? makeFragmentResponse(0) : new Response(null, { status: 404 }),
    );
    const parserFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeEnvelope(0)), { status: 200 }),
    );
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(new Request('https://libretv.example/segments', { method: 'POST' }), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'DV_HLS_FRAGMENT_SET_INCOMPLETE',
      analyzedCount: 1,
    });
    expect(parserFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized cumulative signed evidence before reporting any success', async () => {
    const largeEnvelope = { ...makeEnvelope(0), arbitrary: 'x'.repeat(4 * 1024 * 1024 - 500) };
    // A single response under the 4 MiB cap is still limited by its signature
    // and schema validation. Never accept auxiliary, unsigned fields.
    const parserFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(largeEnvelope), { status: 200 }),
    );
    vi.stubGlobal('fetch', parserFetch);
    const response = await POST(new Request('https://libretv.example/segments', { method: 'POST' }), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_HLS_FRAGMENT_SIGNED_EVIDENCE_REJECTED' });
  });

  it('rejects a fragment count that changes within the registered rendition', async () => {
    vi.mocked(fetchDolbyVisionHlsAssemblySegment).mockImplementation(async (_resource, _variant, ordinal) => {
      const response = makeFragmentResponse(ordinal);
      if (ordinal !== 1) return response;
      const headers = new Headers(response.headers);
      headers.set('X-DV-HLS-FRAGMENT-COUNT', '3');
      return new Response(fragmentBytes[ordinal], { status: 200, headers });
    });
    const parserFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeEnvelope(0)), { status: 200 }),
    );
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(new Request('https://libretv.example/segments', { method: 'POST' }), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_HLS_SEGMENT_GRAPH_CHANGED' });
    expect(parserFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a decode-time gap even when the registry continuity header claims contiguous timing', async () => {
    vi.mocked(fetchDolbyVisionHlsAssemblySegment).mockImplementation(async (_resource, _variant, ordinal) => {
      const response = makeFragmentResponse(ordinal);
      if (ordinal !== 1) return response;
      const headers = new Headers(response.headers);
      headers.set('X-DV-HLS-DECODE-TIME', '4500');
      return new Response(fragmentBytes[ordinal], { status: 200, headers });
    });
    const parserFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeEnvelope(0)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeEnvelope(1)), { status: 200 }));
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(new Request('https://libretv.example/segments', { method: 'POST' }), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_HLS_FRAGMENT_SIGNED_EVIDENCE_REJECTED' });
  });

  it('rejects a media-fragment sequence-number gap', async () => {
    vi.mocked(fetchDolbyVisionHlsAssemblySegment).mockImplementation(async (_resource, _variant, ordinal) => {
      const response = makeFragmentResponse(ordinal);
      if (ordinal !== 1) return response;
      const headers = new Headers(response.headers);
      headers.set('X-DV-HLS-FRAGMENT-SEQUENCE-NUMBER', '4');
      return new Response(fragmentBytes[ordinal], { status: 200, headers });
    });
    const parserFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeEnvelope(0)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeEnvelope(1)), { status: 200 }));
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(new Request('https://libretv.example/segments', { method: 'POST' }), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'DV_HLS_FRAGMENT_SIGNED_EVIDENCE_REJECTED' });
  });

  it('rejects a registry fragment bound to a different resource ID', async () => {
    vi.mocked(fetchDolbyVisionHlsAssemblySegment).mockImplementation(async (_resource, _variant, ordinal) => {
      const response = makeFragmentResponse(ordinal);
      const headers = new Headers(response.headers);
      headers.set('X-DV-HLS-RESOURCE-ID', 'another-resource');
      return new Response(fragmentBytes[ordinal], { status: 200, headers });
    });
    const parserFetch = vi.fn();
    vi.stubGlobal('fetch', parserFetch);

    const response = await POST(new Request('https://libretv.example/segments', { method: 'POST' }), {
      params: Promise.resolve({ resourceId, variantAssetId }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'DV_HLS_SEGMENT_BINDING_INVALID',
      invalidFields: ['resource-id'],
    });
    expect(parserFetch).not.toHaveBeenCalled();
  });
});
