import { createHash } from 'node:crypto';

/** Authenticated Collector asset graph. Never build playback URLs from CMS-provided paths. */
export interface VerifiedHlsAsset {
  assetId: string; resourceId: string; sha256: string; byteLength: number;
  contentType: string; objectKey: string;
}
export interface VerifiedHlsGraph {
  resourceId: string;
  graph: { graph_id: string; resource_id: string; root_asset_id: string };
  rootAsset: VerifiedHlsAsset;
  members: VerifiedHlsAsset[];
  edges: { parentAssetId: string; childAssetId: string; relativeUri: string; role: string; ordinal: number }[];
}
const id = /^[A-Za-z0-9:_-]{1,200}$/;
const hash = /^[a-f0-9]{64}$/;
const mime = new Set(['application/vnd.apple.mpegurl', 'video/mp4', 'video/iso.segment', 'video/mp2t', 'audio/aac', 'audio/mp4']);
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
function isAsset(v: unknown, resourceId: string): v is VerifiedHlsAsset {
  if (!isObject(v)) return false;
  return v.resourceId === resourceId && typeof v.assetId === 'string' && id.test(v.assetId) &&
    typeof v.sha256 === 'string' && hash.test(v.sha256) &&
    Number.isSafeInteger(v.byteLength) && (v.byteLength as number) > 0 &&
    typeof v.contentType === 'string' && mime.has(v.contentType) &&
    v.objectKey === `sha256/${v.sha256.slice(0, 2)}/${v.sha256}`;
}
/** Restrict the first release to graph-complete, immutable clear VOD; refuse external keys and URLs. */
export function parseVerifiedHlsGraph(data: unknown, resourceId: string, rootAssetId: string): VerifiedHlsGraph | null {
  if (!isObject(data) || !isObject(data.graph) || !isAsset(data.rootAsset, resourceId) ||
      data.resourceId !== resourceId || data.rootAsset.assetId !== rootAssetId ||
      data.graph.graph_id !== rootAssetId || data.graph.root_asset_id !== rootAssetId ||
      data.graph.resource_id !== resourceId || data.rootAsset.contentType !== 'application/vnd.apple.mpegurl' ||
      !Array.isArray(data.members) || !Array.isArray(data.edges) ||
      data.members.length > 10000 || data.edges.length > 50000) return null;
  const assets = new Map<string, VerifiedHlsAsset>([[rootAssetId, data.rootAsset]]);
  for (const member of data.members) {
    if (!isAsset(member, resourceId) || assets.has(member.assetId)) return null;
    assets.set(member.assetId, member);
  }
  let countSegments = 0;
  const edges = [];
  const seen = new Set<string>();
  for (const entry of data.edges) {
    if (!isObject(entry) || typeof entry.parentAssetId !== 'string' ||
        typeof entry.childAssetId !== 'string' || !assets.has(entry.parentAssetId) ||
        !assets.has(entry.childAssetId) || typeof entry.relativeUri !== 'string' ||
        !/^[A-Za-z0-9._/-]{1,1024}$/.test(entry.relativeUri) ||
        entry.relativeUri.startsWith('/') || entry.relativeUri.includes('//') ||
        entry.relativeUri.split('/').some((part) => !part || part === '..' || part === '.') ||
        !Number.isSafeInteger(entry.ordinal) || (entry.ordinal as number) < 0 ||
        !['playlist', 'initialization', 'segment'].includes(String(entry.role))) return null;
    const child = assets.get(entry.childAssetId)!;
    if ((entry.role === 'playlist') !== (child.contentType === 'application/vnd.apple.mpegurl')) return null;
    if (entry.role === 'segment' && child.contentType === 'application/vnd.apple.mpegurl') return null;
    if (entry.role === 'initialization' && !['video/mp4','video/iso.segment'].includes(child.contentType)) return null;
    const k = `${entry.parentAssetId}:${entry.relativeUri}`;
    if (seen.has(k)) return null;
    seen.add(k);
    if (entry.role === 'segment') countSegments++;
    edges.push(entry as unknown as VerifiedHlsGraph['edges'][number]);
  }
  if (countSegments === 0) return null;
  // No detached media: every asset must be reachable from the root.
  const reachable = new Set([rootAssetId]);
  for (let i = 0; i < 17; i++) {
    let changed = false;
    for (const edge of edges) {
      if (reachable.has(edge.parentAssetId) && !reachable.has(edge.childAssetId)) {
        reachable.add(edge.childAssetId); changed = true;
      }
    }
    if (!changed) break;
  }
  if (reachable.size !== assets.size) return null;
  return data as unknown as VerifiedHlsGraph;
}
export function verifiedHlsAsset(graph: VerifiedHlsGraph, assetId: string): VerifiedHlsAsset | null {
  if (graph.rootAsset.assetId === assetId) return graph.rootAsset;
  return graph.members.find((a) => a.assetId === assetId) ?? null;
}
/** A playlist can only reference direct graph edges; no URI query, key, LL-HLS or byte-range. */
export function rewriteVerifiedHlsPlaylist(graph: VerifiedHlsGraph, assetId: string, original: string, basePath: string): string {
  if (original.length > 512 * 1024 || !original.startsWith('#EXTM3U')) throw new Error('Invalid registered playlist');
  const relations = new Map(graph.edges.filter((e) => e.parentAssetId === assetId)
    .map((e) => [e.relativeUri, e]));
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const isMaster = lines.some((line) => line.startsWith('#EXT-X-STREAM-INF:'));
  const isVod = lines.includes('#EXT-X-PLAYLIST-TYPE:VOD') && lines.includes('#EXT-X-ENDLIST');
  if (!isMaster && !isVod) throw new Error('Live or truncated playlist is unsupported');
  if (lines.some((line) => /^#EXT-X-(KEY|SESSION-KEY|MEDIA:|I-FRAME|PART|PRELOAD|SERVER-CONTROL|SKIP|BYTERANGE|DISCONTINUITY|DEFINE|DATERANGE|GAP|CONTENT-STEERING|RENDITION-REPORT)/.test(line))) {
    throw new Error('Encrypted, multi-rendition or discontinuous playlist unsupported');
  }
  let pendingVariant = false;
  let used = 0;
  const urlFor = (uri: string, role: string) => {
    const edge = relations.get(uri);
    if (!edge || edge.role !== role) throw new Error('Unregistered HLS media URI');
    used++;
    return `${basePath}/${encodeURIComponent(edge.childAssetId)}`;
  };
  const result = lines.map((line) => {
    if (line.startsWith('#EXT-X-STREAM-INF:')) { pendingVariant = true; return line; }
    if (line.startsWith('#EXT-X-MAP:')) {
      if (isMaster) throw new Error('Unexpected init in master');
      const match = /^#EXT-X-MAP:URI="([^"]+)"$/.exec(line);
      if (!match) throw new Error('Unsupported HLS initialization attributes');
      return `#EXT-X-MAP:URI="${urlFor(match[1], 'initialization')}"`;
    }
    if (!line || line.startsWith('#')) return line;
    const role = pendingVariant ? 'playlist' : 'segment';
    pendingVariant = false;
    return urlFor(line, role);
  });
  if (pendingVariant || used === 0) throw new Error('Incomplete graph-backed playlist');
  return result.join('\n');
}
export function verifyVerifiedHlsByteHeaders(response: Response, asset: VerifiedHlsAsset, requestedRange?: string | null): boolean {
  if (response.headers.get('x-dv-asset-id') !== asset.assetId ||
      response.headers.get('x-dv-asset-sha256') !== asset.sha256 ||
      response.headers.get('etag') !== `"${asset.sha256}"` ||
      response.headers.get('content-type')?.split(';')[0].trim() !== asset.contentType ||
      response.headers.get('accept-ranges') !== 'bytes') return false;
  const length = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(length) || length < 0) return false;
  if (!requestedRange) return response.status === 200 && length === asset.byteLength;
  const requested = /^bytes=(\d+)-(\d*)$/.exec(requestedRange);
  const actual = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
  if (!requested || !actual || response.status !== 206) return false;
  const start = Number(requested[1]), end = requested[2] ? Math.min(Number(requested[2]), asset.byteLength-1) : asset.byteLength-1;
  return [start,end,asset.byteLength].every(Number.isSafeInteger) &&
    Number(actual[1]) === start && Number(actual[2]) === end &&
    Number(actual[3]) === asset.byteLength && length === end-start+1 && start<=end;
}
export function verifyVerifiedHlsManifestBytes(data: Uint8Array, expectedSha: string): boolean {
  return createHash('sha256').update(data).digest('hex') === expectedSha;
}
