import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { isAuthDisabled } from '@/lib/auth';
import { fetchDolbyVisionHlsAssembly } from '@/lib/resource-collector-client';
import { verifySignedDolbyVisionRpuEnvelope } from '@/lib/dolby-vision/signed-rpu-envelope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parserBase(): string | null {
  const raw = process.env.DV_PARSER_API_BASE?.trim() ?? '';
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.search || parsed.hash ||
        (parsed.pathname !== '' && parsed.pathname !== '/')) return null;
    if (parsed.protocol === 'http:' && parsed.hostname === 'dolby-vision-parser' && parsed.port === '8788') {
      return parsed.origin;
    }
    const hostname = parsed.hostname.toLowerCase();
    const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
    if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443') ||
        ipLiteral || hostname === 'localhost' || !hostname.includes('.') ||
        /(^|\.)(local|internal|localhost|test|invalid)$/.test(hostname)) return null;
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

/** Analyze only a collector-assembled, immutable clear fMP4 HLS rendition. */
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
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(resourceId) ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(variantAssetId)) {
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
  let assembly: Response | null = null;
  try {
    assembly = await fetchDolbyVisionHlsAssembly(resourceId, variantAssetId, timeoutMs);
    if (!assembly) {
      return NextResponse.json({ code: 'DV_HLS_REGISTRY_NOT_CONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    if (assembly.status >= 300 && assembly.status < 400) {
      await assembly.body?.cancel();
      return NextResponse.json({ code: 'DV_HLS_REGISTRY_REDIRECT_REJECTED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!assembly.ok) {
      await assembly.body?.cancel();
      const status = assembly.status === 404 ? 404 : assembly.status === 409 ? 409 : 502;
      return NextResponse.json({ code: 'DV_HLS_ASSEMBLY_FAILED' }, { status, headers: { 'Cache-Control': 'no-store' } });
    }

    const graphId = assembly.headers.get('x-dv-hls-graph-id') ?? '';
    const graphSha256 = (assembly.headers.get('x-dv-hls-graph-sha256') ?? '').toLowerCase();
    const rootAssetId = assembly.headers.get('x-dv-hls-root-asset-id') ?? '';
    const returnedVariantId = assembly.headers.get('x-dv-hls-variant-asset-id') ?? '';
    const assembledSha256 = (assembly.headers.get('x-dv-hls-assembled-sha256') ?? '').toLowerCase();
    const fragmentCount = Number(assembly.headers.get('x-dv-hls-fragment-count'));
    const sequenceContinuity = assembly.headers.get('x-dv-hls-fragment-sequence-continuity');
    const temporalContinuity = assembly.headers.get('x-dv-hls-temporal-continuity');
    const rpuPresence = assembly.headers.get('x-dv-rpu-presence');
    const contentLength = Number(assembly.headers.get('content-length'));
    const contentType = (assembly.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();

    if (!/^[A-Za-z0-9:_-]{1,200}$/.test(graphId) || graphId !== rootAssetId ||
        !/^[a-f0-9]{64}$/.test(graphSha256) ||
        !/^[A-Za-z0-9:_-]{1,200}$/.test(rootAssetId) || returnedVariantId !== variantAssetId ||
        !/^[a-f0-9]{64}$/.test(assembledSha256) ||
        !Number.isSafeInteger(fragmentCount) || fragmentCount < 1 || fragmentCount > 10_000 ||
        sequenceContinuity !== 'sequential' || temporalContinuity !== 'unknown' ||
        rpuPresence !== 'unknown' || contentType !== 'video/mp4' ||
        !Number.isSafeInteger(contentLength) || contentLength <= 0 ||
        contentLength > 512 * 1024 * 1024 || !assembly.body) {
      await assembly.body?.cancel();
      return NextResponse.json({ code: 'DV_HLS_ASSEMBLY_BINDING_INVALID' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }

    const analysisContext = {
      scope: 'hls-fmp4' as const,
      resourceId,
      graphId,
      graphSha256,
      rootAssetId,
      variantAssetId,
      fragmentCount,
      fragmentSequenceContinuity: 'sequential' as const,
      temporalContinuity: 'unknown' as const,
    };
    const syntheticAssetId = `hls:${createHash('sha256').update(`${resourceId}\\0${variantAssetId}`).digest('hex')}`;
    const parserResponse = await fetch(`${parserUrl}/v1/analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${parserToken}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(contentLength),
        'X-DV-Asset-ID': syntheticAssetId,
        'X-DV-Asset-SHA256': assembledSha256,
        'X-DV-Source-Content-Type': 'video/mp4',
        'X-DV-Analysis-Scope': 'hls-fmp4',
        'X-DV-HLS-Resource-ID': resourceId,
        'X-DV-HLS-Graph-ID': graphId,
        'X-DV-HLS-Graph-SHA256': graphSha256,
        'X-DV-HLS-Root-Asset-ID': rootAssetId,
        'X-DV-HLS-Variant-Asset-ID': variantAssetId,
        'X-DV-HLS-Fragment-Count': String(fragmentCount),
        'X-DV-HLS-Fragment-Sequence-Continuity': 'sequential',
        'X-DV-HLS-Temporal-Continuity': 'unknown',
      },
      body: assembly.body,
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
      return NextResponse.json({ code: 'DV_HLS_PARSER_ANALYSIS_FAILED' }, { status, headers: { 'Cache-Control': 'no-store' } });
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(await readLimitedText(parserResponse, 4 * 1024 * 1024));
    } catch {
      return NextResponse.json({ code: 'DV_HLS_PARSER_RESPONSE_INVALID' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const verified = verifySignedDolbyVisionRpuEnvelope(envelope, {
      publicKeyPem: signingPublicKeyPem,
      expectedKeyId,
      expectedAssetId: syntheticAssetId,
      expectedMediaSha256: assembledSha256,
      expectedAnalysisContext: analysisContext,
    });
    if (!verified) {
      return NextResponse.json({ code: 'DV_HLS_SIGNED_EVIDENCE_REJECTED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      verified: true,
      analysisScope: 'hls-fmp4',
      resourceId,
      variantAssetId,
      assembledSha256,
      graph: verified.analysisContext,
      keyId: verified.keyId,
      issuedAt: verified.issuedAt,
      expiresAt: verified.expiresAt,
      sourceHashBinding: verified.sourceHashBinding,
      evidence: verified.evidence,
      temporalContinuity: 'unknown',
      crossSegmentRpuContinuity: 'not-verified',
    }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    await assembly?.body?.cancel().catch(() => undefined);
    return NextResponse.json({ code: 'DV_HLS_ANALYSIS_UNAVAILABLE' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
