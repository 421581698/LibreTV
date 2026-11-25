import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import { isAuthDisabled } from '@/lib/auth';
import { collectorRequest } from '@/lib/resource-collector-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MEMBERS = 10_000;
const MAX_EDGES = 50_000;
const CONTENT_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'video/mp4',
  'video/iso.segment',
  'video/mp2t',
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'text/vtt',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAsset(value: unknown, resourceId: string): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return value.resourceId === resourceId &&
    typeof value.assetId === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(value.assetId) &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.byteLength === 'number' && Number.isSafeInteger(value.byteLength) && value.byteLength > 0 &&
    typeof value.contentType === 'string' && CONTENT_TYPES.has(value.contentType) &&
    value.objectKey === `sha256/${value.sha256.slice(0, 2)}/${value.sha256}`;
}

/** Return the verified immutable HLS graph without exposing collector credentials or object paths. */
export async function GET(
  request: Request,
  context: { params: Promise<{ resourceId: string }> },
) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  if (isAuthDisabled()) {
    return NextResponse.json(
      { code: 'DV_HLS_GRAPH_AUTH_REQUIRED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { resourceId } = await context.params;
  if (!/^[a-z0-9_-]{1,80}$/i.test(resourceId)) {
    return NextResponse.json(
      { code: 'DV_RESOURCE_ID_INVALID' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const upstream = await collectorRequest(
    `/v1/registry/resources/${encodeURIComponent(resourceId)}/hls-graph`,
    {},
    5_000,
  );
  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : upstream.status === 409 ? 409 : 503;
    return NextResponse.json(
      { code: status === 404 ? 'DV_HLS_GRAPH_NOT_FOUND' : status === 409 ? 'DV_HLS_GRAPH_NOT_ELIGIBLE' : 'DV_HLS_GRAPH_UNAVAILABLE' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const payload: unknown = await upstream.json().catch(() => null);
  if (!isRecord(payload) || payload.resourceId !== resourceId || !isRecord(payload.graph) ||
      !isAsset(payload.rootAsset, resourceId) || !Array.isArray(payload.members) ||
      !Array.isArray(payload.edges) || payload.members.length > MAX_MEMBERS ||
      payload.edges.length > MAX_EDGES) {
    return NextResponse.json(
      { code: 'DV_HLS_GRAPH_RESPONSE_INVALID' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const root = payload.rootAsset;
  if (root.contentType !== 'application/vnd.apple.mpegurl' ||
      payload.graph.resource_id !== resourceId || payload.graph.root_asset_id !== root.assetId ||
      typeof payload.graph.graph_id !== 'string' || payload.graph.graph_id !== root.assetId) {
    return NextResponse.json(
      { code: 'DV_HLS_GRAPH_BINDING_INVALID' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const memberIds = new Set<string>();
  const members: Array<Record<string, unknown>> = [];
  for (const item of payload.members) {
    if (!isAsset(item, resourceId) || memberIds.has(String(item.assetId)) || item.assetId === root.assetId) {
      return NextResponse.json(
        { code: 'DV_HLS_GRAPH_MEMBER_INVALID' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    memberIds.add(String(item.assetId));
    members.push({
      assetId: item.assetId,
      sha256: item.sha256,
      byteLength: item.byteLength,
      contentType: item.contentType,
    });
  }

  const edges: Array<Record<string, unknown>> = [];
  const edgeKeys = new Set<string>();
  for (const item of payload.edges) {
    if (!isRecord(item) ||
        typeof item.parentAssetId !== 'string' ||
        (item.parentAssetId !== root.assetId && !memberIds.has(item.parentAssetId)) ||
        typeof item.childAssetId !== 'string' || !memberIds.has(item.childAssetId) ||
        !['playlist', 'initialization', 'segment', 'subtitle'].includes(String(item.role)) ||
        typeof item.relativeUri !== 'string' || !item.relativeUri || item.relativeUri.length > 2048 ||
        !Number.isSafeInteger(item.ordinal) || Number(item.ordinal) < 0) {
      return NextResponse.json(
        { code: 'DV_HLS_GRAPH_EDGE_INVALID' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const edgeKey = `${item.parentAssetId}:${item.ordinal}`;
    if (edgeKeys.has(edgeKey)) {
      return NextResponse.json(
        { code: 'DV_HLS_GRAPH_EDGE_DUPLICATE' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    edgeKeys.add(edgeKey);
    edges.push({
      parentAssetId: item.parentAssetId,
      childAssetId: item.childAssetId,
      role: item.role,
      ordinal: item.ordinal,
    });
  }

  return NextResponse.json({
    resourceId,
    graphId: payload.graph.graph_id,
    rootAsset: {
      assetId: root.assetId,
      sha256: root.sha256,
      byteLength: root.byteLength,
    },
    members,
    edges,
    rpuPresence: 'unknown',
    notes: [
      '此接口返回已登记 HLS 资产图的不可变字节身份和边关系。',
      '返回图结构不代表已经读取或解析媒体分片中的 Dolby Vision RPU。',
    ],
  }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
