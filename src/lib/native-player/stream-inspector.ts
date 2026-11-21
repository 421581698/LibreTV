export interface HlsVariant {
  readonly uri: string;
  readonly bandwidth: number | null;
  readonly averageBandwidth: number | null;
  readonly codecs: string[];
  readonly width: number | null;
  readonly height: number | null;
  readonly audioGroup: string | null;
  readonly subtitleGroup: string | null;
}
export interface HlsRendition {
  readonly type: 'AUDIO' | 'SUBTITLES';
  readonly groupId: string;
  readonly name: string;
  readonly language: string | null;
  readonly uri: string | null;
  readonly isDefault: boolean;
  readonly autoselect: boolean;
}
export interface HlsManifestSummary {
  readonly kind: 'master' | 'media' | 'unknown';
  readonly variants: HlsVariant[];
  readonly renditions: HlsRendition[];
  readonly segmentCount: number;
  readonly targetDuration: number | null;
  readonly hasInitMap: boolean;
  readonly discontinuityCount: number;
  readonly isLive: boolean;
}

function parseAttributes(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const raw = match[2].trim();
    result[match[1]] = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"') : raw;
  }
  return result;
}
function positiveNumber(value?: string): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
function resolveUri(uri: string, baseUrl?: string): string {
  if (!baseUrl) return uri;
  try { return new URL(uri, baseUrl).toString(); } catch { return uri; }
}

/** Parses manifest metadata only. It performs no network requests and never fetches segment URLs. */
export function inspectHlsManifest(text: string, baseUrl?: string): HlsManifestSummary {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') {
    return { kind: 'unknown', variants: [], renditions: [], segmentCount: 0, targetDuration: null, hasInitMap: false, discontinuityCount: 0, isLive: false };
  }

  const variants: HlsVariant[] = [];
  const renditions: HlsRendition[] = [];
  let pendingVariant: Record<string, string> | null = null;
  let segmentCount = 0;
  let targetDuration: number | null = null;
  let hasInitMap = false;
  let discontinuityCount = 0;
  let isLive = true;

  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pendingVariant = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      continue;
    }
    if (pendingVariant && !line.startsWith('#')) {
      const resolution = pendingVariant.RESOLUTION?.match(/^(\d+)x(\d+)$/i);
      variants.push({
        uri: resolveUri(line, baseUrl),
        bandwidth: positiveNumber(pendingVariant.BANDWIDTH),
        averageBandwidth: positiveNumber(pendingVariant['AVERAGE-BANDWIDTH']),
        codecs: (pendingVariant.CODECS || '').split(',').map(value => value.trim()).filter(Boolean),
        width: resolution ? Number(resolution[1]) : null,
        height: resolution ? Number(resolution[2]) : null,
        audioGroup: pendingVariant.AUDIO || null,
        subtitleGroup: pendingVariant.SUBTITLES || null,
      });
      pendingVariant = null;
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
      if (attrs.TYPE === 'AUDIO' || attrs.TYPE === 'SUBTITLES') {
        renditions.push({
          type: attrs.TYPE,
          groupId: attrs['GROUP-ID'] || '',
          name: attrs.NAME || '',
          language: attrs.LANGUAGE || null,
          uri: attrs.URI ? resolveUri(attrs.URI, baseUrl) : null,
          isDefault: attrs.DEFAULT === 'YES',
          autoselect: attrs.AUTOSELECT === 'YES',
        });
      }
    }
    if (line.startsWith('#EXTINF:')) segmentCount += 1;
    if (line.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = positiveNumber(line.split(':', 2)[1]);
    if (line.startsWith('#EXT-X-MAP:')) hasInitMap = true;
    if (line === '#EXT-X-DISCONTINUITY') discontinuityCount += 1;
    if (line === '#EXT-X-ENDLIST') isLive = false;
  }

  return {
    kind: variants.length ? 'master' : segmentCount || targetDuration !== null ? 'media' : 'unknown',
    variants,
    renditions,
    segmentCount,
    targetDuration,
    hasInitMap,
    discontinuityCount,
    isLive,
  };
}
