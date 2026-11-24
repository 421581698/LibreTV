import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { isAuthDisabled } from '@/lib/auth';
import { fetchDolbyVisionRegistryAsset } from '@/lib/resource-collector-client';
import { verifySignedDolbyVisionRpuEnvelope } from '@/lib/dolby-vision/signed-rpu-envelope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_MEDIA_TYPES = new Set(['video/mp4']);

function boundedEnvInteger(name: string, fallback: number, minimum: number, maximum: number): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}

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
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
    if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443') ||
        isIpLiteral || hostname === 'localhost' || !hostname.includes('.') ||
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

export async function POST(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  // This route uses server-side collector credentials, so the generic public-preview
  // bypass (which is intended for browser-supplied collector credentials) is unsafe.
  if (isAuthDisabled()) {
    return NextResponse.json({ code: 'DV_ANALYSIS_AUTH_REQUIRED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const { assetId } = await context.params;
  if (!/^[A-Za-z0-9:_-]{1,200}$/.test(assetId)) {
    return NextResponse.json({ code: 'DV_ASSET_ID_INVALID' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const parserUrl = parserBase();
  const parserToken = process.env.DV_SERVICE_TOKEN?.trim() ?? '';
  const expectedKeyId = process.env.DV_SIGNING_KEY_ID?.trim() ?? '';
  const signingPublicKeyPem = publicKeyPem();
  const maximumUploadBytes = boundedEnvInteger('DV_MAX_UPLOAD_BYTES', 512 * 1024 * 1024, 1024, 2 * 1024 * 1024 * 1024);
  const analysisTimeoutMs = boundedEnvInteger('DV_ANALYSIS_TIMEOUT_MS', 15 * 60 * 1000, 10_000, 60 * 60 * 1000);
  if (!parserUrl || !parserToken || parserToken.length > 4096 || !expectedKeyId ||
      expectedKeyId.length > 128 || !signingPublicKeyPem || maximumUploadBytes === null || analysisTimeoutMs === null) {
    return NextResponse.json({ code: 'DV_ANALYSIS_NOT_CONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const timeoutMs = analysisTimeoutMs + 60_000;
  let mediaResponse: Response | null = null;
  try {
    // This fetch uses only server-configured collector credentials. Browser
    // supplied x-scrapling-* headers are deliberately ignored for DV evidence.
    mediaResponse = await fetchDolbyVisionRegistryAsset(assetId, timeoutMs);
    if (!mediaResponse) {
      return NextResponse.json({ code: 'DV_REGISTRY_NOT_CONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    if (mediaResponse.status >= 300 && mediaResponse.status < 400) {
      await mediaResponse.body?.cancel();
      return NextResponse.json({ code: 'DV_REGISTRY_REDIRECT_REJECTED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!mediaResponse.ok) {
      await mediaResponse.body?.cancel();
      return NextResponse.json(
        { code: mediaResponse.status === 404 ? 'DV_ASSET_NOT_FOUND' : 'DV_ASSET_UNAVAILABLE' },
        { status: mediaResponse.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const returnedAssetId = mediaResponse.headers.get('x-dv-asset-id') ?? '';
    const digest = (mediaResponse.headers.get('x-dv-asset-sha256') ?? '').toLowerCase();
    const etag = mediaResponse.headers.get('etag') ?? '';
    const contentLengthRaw = mediaResponse.headers.get('content-length') ?? '';
    const contentLength = Number(contentLengthRaw);
    const contentType = (mediaResponse.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (Number.isSafeInteger(contentLength) && contentLength > maximumUploadBytes) {
      await mediaResponse.body?.cancel();
      return NextResponse.json({ code: 'DV_MEDIA_TOO_LARGE' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    }
    if (returnedAssetId !== assetId || !/^[a-f0-9]{64}$/.test(digest) ||
        etag !== `"${digest}"` || !Number.isSafeInteger(contentLength) ||
        contentLength <= 0 ||
        !ALLOWED_MEDIA_TYPES.has(contentType) || !mediaResponse.body) {
      await mediaResponse.body?.cancel();
      return NextResponse.json({ code: 'DV_ASSET_BINDING_INVALID' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }

    const parserResponse = await fetch(`${parserUrl}/v1/analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${parserToken}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(contentLength),
        'X-DV-Asset-ID': assetId,
        'X-DV-Asset-SHA256': digest,
        'X-DV-Source-Content-Type': contentType,
      },
      body: mediaResponse.body,
      // Node's fetch requires half-duplex mode when forwarding a live stream.
      duplex: 'half',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit & { duplex: 'half' });

    if (parserResponse.status >= 300 && parserResponse.status < 400) {
      await parserResponse.body?.cancel();
      return NextResponse.json({ code: 'DV_PARSER_REDIRECT_REJECTED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!parserResponse.ok) {
      await parserResponse.body?.cancel();
      const status = parserResponse.status === 429 ? 429 : parserResponse.status === 413 ? 413 : 502;
      return NextResponse.json({ code: 'DV_PARSER_ANALYSIS_FAILED' }, { status, headers: { 'Cache-Control': 'no-store' } });
    }

    const rawEnvelope = await readLimitedText(parserResponse, 4 * 1024 * 1024);
    let envelope: unknown;
    try {
      envelope = JSON.parse(rawEnvelope);
    } catch {
      return NextResponse.json({ code: 'DV_PARSER_RESPONSE_INVALID' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const verified = verifySignedDolbyVisionRpuEnvelope(envelope, {
      publicKeyPem: signingPublicKeyPem,
      expectedKeyId,
      expectedAssetId: assetId,
      expectedMediaSha256: digest,
    });
    if (!verified) {
      return NextResponse.json({ code: 'DV_SIGNED_EVIDENCE_REJECTED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      verified: true,
      assetId: verified.assetId,
      keyId: verified.keyId,
      issuedAt: verified.issuedAt,
      expiresAt: verified.expiresAt,
      sourceHashBinding: verified.sourceHashBinding,
      evidence: verified.evidence,
      report: verified.report,
    }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    await mediaResponse?.body?.cancel().catch(() => undefined);
    return NextResponse.json({ code: 'DV_ANALYSIS_UNAVAILABLE' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
