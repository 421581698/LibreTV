import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { isAuthDisabled } from '@/lib/auth';
import { fetchDolbyVisionHlsAssemblySegment } from '@/lib/resource-collector-client';
import { verifySignedDolbyVisionRpuSegmentSet, type ExpectedHlsRpuFragment } from '@/lib/dolby-vision/signed-rpu-envelope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parserBase(): string | null {
  const raw = process.env.DV_PARSER_API_BASE?.trim() ?? '';
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.search || parsed.hash ||
        (parsed.pathname !== '' && parsed.pathname !== '/')) return null;
    if (parsed.protocol === 'http:' && parsed.hostname === 'dolby-vision-parser' && parsed.port === '8788') return parsed.origin;
    const hostname = parsed.hostname.toLowerCase();
    const ipLiteral = /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
    if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443') ||
        ipLiteral || hostname === 'localhost' || !hostname.includes('.') ||
        /(^|\\.)(local|internal|localhost|test|invalid)$/.test(hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function publicKeyPem(): string | null {
  const encoded = process.env.DV_SIGNING_PUBLIC_KEY_PEM_B64?.trim() ?? '';
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    const pem = Buffer.from(encoded, 'base64').toString('utf8');
    return pem.includes('-----BEGIN PUBLIC KEY-----') && pem.includes('-----END PUBLIC KEY-----') ? pem : null;
  } catch {
    return null;
  }
}

function integerHeader(headers: Headers, name: string, minimum = 0): number | null {
  const raw = headers.get(name);
  if (raw === null || !/^(?:0|[1-9]\\d*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum ? value : null;
}

async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('Parser response exceeded its size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Parse, sign, and verify every registered HLS fMP4 fragment independently. */
export async function POST(
  request: Request,
  context: { params: Promise<{ resourceId: string; variantAssetId: string }> },
) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  if (isAuthDisabled()) {
    return NextResponse.json({ code: 'DV_HLS_ANALYSIS_AUTH_REQUIRED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const { resourceId, variantAssetId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(resourceId) || !/^[A-Za-z0-9:_-]{1,200}$/.test(variantAssetId)) {
    return NextResponse.json({ code: 'DV_HLS_ID_INVALID' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const parserUrl = parserBase();
  const parserToken = process.env.DV_SERVICE_TOKEN?.trim() ?? '';
  const expectedKeyId = process.env.DV_SIGNING_KEY_ID?.trim() ?? '';
  const signingPublicKeyPem = publicKeyPem();
  if (!parserUrl || !parserToken || parserToken.length > 4096 ||
      !expectedKeyId || expectedKeyId.length > 128 || !signingPublicKeyPem) {
    return NextResponse.json({ code: 'DV_HLS_ANALYSIS_NOT_CONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const timeoutMs = 16 * 60 * 1000;
  const expectedSegments: ExpectedHlsRpuFragment[] = [];
  const envelopes: unknown[] = [];
  let graph: {
    graphId: string; graphSha256: string; rootAssetId: string;
    variantAssetId: string; fragmentCount: number;
  } | null = null;

  try {
    for (let ordinal = 0; ordinal < 10_000; ordinal += 1) {
      const fragment = await fetchDolbyVisionHlsAssemblySegment(resourceId, variantAssetId, ordinal, timeoutMs);
      if (!fragment) {
        return NextResponse.json({ code: 'DV_HLS_REGISTRY_NOT_CONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      if (fragment.status >= 300 && fragment.status < 400) {
        await fragment.body?.cancel();
        return NextResponse.json({ code: 'DV_HLS_REGISTRY_REDIRECT_REJECTED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
      if (ordinal > 0 && fragment.status === 404) {
        await fragment.body?.cancel();
        break;
      }
      if (!fragment.ok) {
        await fragment.body?.cancel();
        const status = fragment.status === 404 ? 404 : fragment.status === 409 ? 409 : 502;
        return NextResponse.json({ code: 'DV_HLS_SEGMENT_ASSEMBLY_FAILED' }, { status, headers: { 'Cache-Control': 'no-store' } });
      }

      const currentGraph = {
        graphId: fragment.headers.get('x-dv-hls-graph-id') ?? '',
        graphSha256: (fragment.headers.get('x-dv-hls-graph-sha256') ?? '').toLowerCase(),
        rootAssetId: fragment.headers.get('x-dv-hls-root-asset-id') ?? '',
        variantAssetId: fragment.headers.get('x-dv-hls-variant-asset-id') ?? '',
        fragmentCount: integerHeader(fragment.headers, 'x-dv-hls-fragment-count', 1),
      };
      const fragmentOrdinal = integerHeader(fragment.headers, 'x-dv-hls-fragment-ordinal');
      const fragmentAssetId = fragment.headers.get('x-dv-hls-fragment-asset-id') ?? '';
      const fragmentSha256 = (fragment.headers.get('x-dv-hls-fragment-sha256') ?? '').toLowerCase();
      const initializationAssetId = fragment.headers.get('x-dv-hls-initialization-asset-id') ?? '';
      const initializationSha256 = (fragment.headers.get('x-dv-hls-initialization-sha256') ?? '').toLowerCase();
      const assembledSegmentSha256 = (fragment.headers.get('x-dv-hls-assembled-segment-sha256') ?? '').toLowerCase();
      const fragmentSequenceNumber = integerHeader(fragment.headers, 'x-dv-hls-fragment-sequence-number', 1);
      const decodeTime = integerHeader(fragment.headers, 'x-dv-hls-decode-time');
      const sampleDuration = integerHeader(fragment.headers, 'x-dv-hls-sample-duration', 1);
      const sampleCount = integerHeader(fragment.headers, 'x-dv-hls-sample-count', 1);
      const timescale = integerHeader(fragment.headers, 'x-dv-hls-timescale', 1);
      const contentLength = integerHeader(fragment.headers, 'content-length', 1);
      const contentType = (fragment.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      const assetIdHeader = fragment.headers.get('x-dv-asset-id') ?? '';
      const assetShaHeader = (fragment.headers.get('x-dv-asset-sha256') ?? '').toLowerCase();

      const bindingFailures = [
        !/^[A-Za-z0-9:_-]{1,200}$/.test(currentGraph.graphId) ? 'graph-id' : null,
        !/^[a-f0-9]{64}$/.test(currentGraph.graphSha256) ? 'graph-sha256' : null,
        !/^[A-Za-z0-9:_-]{1,200}$/.test(currentGraph.rootAssetId) ? 'root-asset-id' : null,
        currentGraph.variantAssetId !== variantAssetId ? 'variant-asset-id' : null,
        currentGraph.fragmentCount === null || currentGraph.fragmentCount > 10_000 ? 'fragment-count' : null,
        fragmentOrdinal !== ordinal ? 'fragment-ordinal' : null,
        !/^[A-Za-z0-9:_-]{1,200}$/.test(fragmentAssetId) ? 'fragment-asset-id' : null,
        !/^[a-f0-9]{64}$/.test(fragmentSha256) ? 'fragment-sha256' : null,
        !/^[A-Za-z0-9:_-]{1,200}$/.test(initializationAssetId) ? 'initialization-asset-id' : null,
        !/^[a-f0-9]{64}$/.test(initializationSha256) ? 'initialization-sha256' : null,
        !/^[a-f0-9]{64}$/.test(assembledSegmentSha256) ? 'assembled-segment-sha256' : null,
        fragmentSequenceNumber === null ? 'fragment-sequence-number' : null,
        decodeTime === null ? 'decode-time' : null,
        sampleDuration === null ? 'sample-duration' : null,
        sampleCount === null ? 'sample-count' : null,
        timescale === null ? 'timescale' : null,
        assetIdHeader !== fragmentAssetId ? 'asset-id-header' : null,
        assetShaHeader !== assembledSegmentSha256 ? 'asset-sha256-header' : null,
        fragment.headers.get('x-dv-analysis-scope') !== 'hls-fmp4-segment' ? 'analysis-scope' : null,
        fragment.headers.get('x-dv-hls-fragment-sequence-continuity') !== 'sequential' ? 'sequence-continuity' : null,
        fragment.headers.get('x-dv-hls-temporal-continuity') !== 'contiguous' ? 'temporal-continuity' : null,
        contentType !== 'video/mp4' ? 'content-type' : null,
        contentLength !== null && contentLength > 512 * 1024 * 1024 ? 'content-length' : null,
        !fragment.body ? 'body' : null,
      ].filter((value): value is string => value !== null);
      if (bindingFailures.length > 0) {
        await fragment.body?.cancel();
        return NextResponse.json(
          { code: 'DV_HLS_SEGMENT_BINDING_INVALID', invalidFields: bindingFailures },
          { status: 409, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      if (graph === null) {
        graph = {
          graphId: currentGraph.graphId,
          graphSha256: currentGraph.graphSha256,
          rootAssetId: currentGraph.rootAssetId,
          variantAssetId: currentGraph.variantAssetId,
          fragmentCount: currentGraph.fragmentCount,
        };
      } else if (JSON.stringify(graph) !== JSON.stringify(currentGraph)) {
        await fragment.body.cancel();
        return NextResponse.json({ code: 'DV_HLS_SEGMENT_GRAPH_CHANGED' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      }
      if (currentGraph.fragmentCount !== ordinal + 1 && currentGraph.fragmentCount <= ordinal) {
        await fragment.body.cancel();
        return NextResponse.json({ code: 'DV_HLS_SEGMENT_COUNT_INVALID' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      }

      const expected: ExpectedHlsRpuFragment = {
        fragmentAssetId,
        fragmentSha256,
        initializationAssetId,
        initializationSha256,
        assembledSegmentSha256,
        fragmentSequenceNumber,
        decodeTime,
        sampleDuration,
        sampleCount,
        timescale,
      };
      const parserResponse = await fetch(`${parserUrl}/v1/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${parserToken}`,
          'Content-Type': 'application/octet-stream',
          ...(contentLength !== null ? { 'Content-Length': String(contentLength) } : {}),
          'X-DV-Asset-ID': fragmentAssetId,
          'X-DV-Asset-SHA256': assembledSegmentSha256,
          'X-DV-Source-Content-Type': 'video/mp4',
          'X-DV-Analysis-Scope': 'hls-fmp4-segment',
          'X-DV-HLS-Resource-ID': resourceId,
          'X-DV-HLS-Graph-ID': currentGraph.graphId,
          'X-DV-HLS-Graph-SHA256': currentGraph.graphSha256,
          'X-DV-HLS-Root-Asset-ID': currentGraph.rootAssetId,
          'X-DV-HLS-Variant-Asset-ID': variantAssetId,
          'X-DV-HLS-Fragment-Count': String(currentGraph.fragmentCount),
          'X-DV-HLS-Fragment-Sequence-Continuity': 'sequential',
          'X-DV-HLS-Temporal-Continuity': 'contiguous',
          'X-DV-HLS-Fragment-Ordinal': String(fragmentOrdinal),
          'X-DV-HLS-Fragment-Asset-ID': fragmentAssetId,
          'X-DV-HLS-Fragment-SHA256': fragmentSha256,
          'X-DV-HLS-Initialization-Asset-ID': initializationAssetId,
          'X-DV-HLS-Initialization-SHA256': initializationSha256,
          'X-DV-HLS-Assembled-Segment-SHA256': assembledSegmentSha256,
          'X-DV-HLS-Fragment-Sequence-Number': String(fragmentSequenceNumber),
          'X-DV-HLS-Decode-Time': String(decodeTime),
          'X-DV-HLS-Sample-Duration': String(sampleDuration),
          'X-DV-HLS-Sample-Count': String(sampleCount),
          'X-DV-HLS-Timescale': String(timescale),
        },
        body: fragment.body,
        duplex: 'half',
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      } as RequestInit & { duplex: 'half' });

      if (parserResponse.status >= 300 && parserResponse.status < 400) {
        await parserResponse.body?.cancel();
        return NextResponse.json({ code: 'DV_HLS_PARSER_REDIRECT_REJECTED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
      if (!parserResponse.ok) {
        await parserResponse.body?.cancel();
        const status = parserResponse.status === 429 ? 429 : parserResponse.status === 413 ? 413 : 502;
        return NextResponse.json({ code: 'DV_HLS_FRAGMENT_ANALYSIS_FAILED', ordinal }, { status, headers: { 'Cache-Control': 'no-store' } });
      }
      let envelope: unknown;
      try {
        const text = await readLimitedText(parserResponse, 4 * 1024 * 1024);
        envelope = JSON.parse(text);
      } catch {
        return NextResponse.json({ code: 'DV_HLS_FRAGMENT_PARSER_RESPONSE_INVALID', ordinal }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
      expectedSegments.push(expected);
      envelopes.push(envelope);
      if (graph && ordinal + 1 === graph.fragmentCount) break;
    }

    if (!graph || expectedSegments.length !== graph.fragmentCount || envelopes.length !== graph.fragmentCount) {
      return NextResponse.json({ code: 'DV_HLS_FRAGMENT_SET_INCOMPLETE' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
    const verified = verifySignedDolbyVisionRpuSegmentSet(envelopes, {
      publicKeyPem: signingPublicKeyPem,
      expectedKeyId,
      resourceId,
      graphId: graph.graphId,
      graphSha256: graph.graphSha256,
      rootAssetId: graph.rootAssetId,
      variantAssetId: graph.variantAssetId,
      expectedFragmentCount: graph.fragmentCount,
      expectedSegments,
    });
    if (!verified) {
      return NextResponse.json({ code: 'DV_HLS_FRAGMENT_SIGNED_EVIDENCE_REJECTED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      verified: true,
      analysisScope: 'hls-fmp4-segment-set',
      resourceId,
      variantAssetId,
      graph: { ...graph, fragmentSequenceContinuity: 'sequential', temporalContinuity: 'contiguous' },
      segmentCount: verified.segments.length,
      totalRpuFrameCount: verified.totalRpuFrameCount,
      segments: verified.segments.map((segment, ordinal) => ({
        ordinal,
        fragmentAssetId: segment.analysisContext?.scope === 'hls-fmp4-segment' ? segment.analysisContext.fragmentAssetId : null,
        frameCount: segment.report.frameCount,
        profiles: segment.report.profiles,
        metadataLevels: segment.report.metadataLevels,
        rpuSha256: segment.report.rpuSha256,
      })),
      timelineContinuity: verified.timelineContinuity,
      rpuProfileContinuity: verified.rpuProfileContinuity,
      rpuSemanticContinuity: verified.rpuSemanticContinuity,
    }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ code: 'DV_HLS_SEGMENT_ANALYSIS_UNAVAILABLE' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
