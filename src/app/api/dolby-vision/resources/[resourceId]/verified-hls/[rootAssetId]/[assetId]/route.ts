import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { isAuthDisabled } from '@/lib/auth';
import { fetchDolbyVisionHlsGraph, fetchDolbyVisionRegistryAsset } from '@/lib/resource-collector-client';
import { parseVerifiedHlsGraph, verifiedHlsAsset, rewriteVerifiedHlsPlaylist, verifyVerifiedHlsByteHeaders, verifyVerifiedHlsManifestBytes } from '@/lib/dolby-vision/verified-hls-playback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Opt-in clear VOD gateway: every byte originates from the authenticated, SHA-verified registry. */
export async function GET(request: Request, context: { params: Promise<{ resourceId: string; rootAssetId: string; assetId: string }> }) {
  const denied = guardPrivateFeatureRequest(request);
  if (denied) return denied;
  if (isAuthDisabled()) return NextResponse.json({ code: 'HLS_AUTH_REQUIRED' }, { status: 503 });
  const { resourceId, rootAssetId, assetId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(resourceId) ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(rootAssetId) ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(assetId)) return NextResponse.json({ code: 'HLS_ID_INVALID' }, { status: 400 });
  const range = request.headers.get('range');
  if (range && (!/^bytes=\d+-\d*$/.test(range) || range.length > 64)) {
    return NextResponse.json({ code: 'HLS_RANGE_INVALID' }, { status: 416 });
  }
  try {
    const graphResponse = await fetchDolbyVisionHlsGraph(resourceId);
    if (!graphResponse || !graphResponse.ok) {
      await graphResponse?.body?.cancel();
      return NextResponse.json({ code: 'HLS_GRAPH_UNAVAILABLE' }, { status: 503 });
    }
    const graph = parseVerifiedHlsGraph(await graphResponse.json(), resourceId, rootAssetId);
    const asset = graph && verifiedHlsAsset(graph, assetId);
    if (!graph || !asset) return NextResponse.json({ code: 'HLS_GRAPH_BINDING_INVALID' }, { status: 409 });
    if (range && asset.contentType === 'application/vnd.apple.mpegurl') {
      return NextResponse.json({ code: 'HLS_MANIFEST_RANGE_UNSUPPORTED' }, { status: 416 });
    }
    const upstream = await fetchDolbyVisionRegistryAsset(assetId, 20000, range ?? undefined);
    if (!upstream || !verifyVerifiedHlsByteHeaders(upstream, asset, range)) {
      await upstream?.body?.cancel();
      return NextResponse.json({ code: 'HLS_BYTES_INTEGRITY_REJECTED' }, { status: 502 });
    }
    const headers = new Headers({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Cinema-Playback-Bytes': 'registry-verified',
      'Content-Type': asset.contentType,
      'ETag': `"${asset.sha256}"`,
      'Accept-Ranges': 'bytes',
    });
    if (asset.contentType !== 'application/vnd.apple.mpegurl') {
      headers.set('Content-Length', upstream.headers.get('content-length')!);
      if (range) headers.set('Content-Range', upstream.headers.get('content-range')!);
      return new Response(upstream.body, { status: range ? 206 : 200, headers });
    }
    if (asset.byteLength > 512 * 1024) {
      await upstream.body?.cancel();
      return NextResponse.json({ code: 'HLS_PLAYLIST_TOO_LARGE' }, { status: 413 });
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length !== asset.byteLength || !verifyVerifiedHlsManifestBytes(bytes, asset.sha256)) {
      return NextResponse.json({ code: 'HLS_PLAYLIST_SHA256_MISMATCH' }, { status: 409 });
    }
    const playlist = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const base = `/api/dolby-vision/resources/${encodeURIComponent(resourceId)}/verified-hls/${encodeURIComponent(rootAssetId)}`;
    const rewritten = rewriteVerifiedHlsPlaylist(graph, assetId, playlist, base);
    // The rewritten manifest is intentionally a *different* byte stream. Only
    // the source object hash, checked above, is the immutable registry identity.
    headers.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    headers.delete('ETag');
    headers.set('X-Cinema-Manifest-Source-SHA256', asset.sha256);
    return new Response(rewritten, { status: 200, headers });
  } catch {
    return NextResponse.json({ code: 'HLS_VERIFIED_GATEWAY_UNAVAILABLE' }, { status: 502 });
  }
}
