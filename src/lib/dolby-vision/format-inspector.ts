/**
 * Dolby Vision declaration inspection.
 *
 * This module parses declarations from URLs, RFC 6381 codec strings and HLS
 * master-playlist attributes. It does not inspect elementary-stream bytes,
 * decode video, or prove that the active display path outputs Dolby Vision.
 */
export type DolbyVisionCodecFamily = 'hevc' | 'av1' | 'avc' | 'unknown';
export type DolbyVisionDeclarationSource = 'codecs' | 'supplemental-codecs';

export interface DolbyVisionCodecDeclaration {
  raw: string;
  codec: 'dvhe' | 'dvh1' | 'dav1' | 'dva1';
  profile: number;
  level: number;
  family: DolbyVisionCodecFamily;
  source: DolbyVisionDeclarationSource;
}

export interface DolbyVisionFormatInput {
  url?: string | null;
  mimeType?: string | null;
  codecs?: string | string[] | null;
  supplementalCodecs?: string | string[] | null;
  manifest?: string | null;
}

export interface DolbyVisionFormatReport {
  container: 'hls' | 'mp4' | 'mpeg-ts' | 'unknown';
  detected: boolean;
  declarations: DolbyVisionCodecDeclaration[];
  profiles: number[];
  levels: number[];
  codecFamilies: DolbyVisionCodecFamily[];
  videoRange: 'PQ' | 'HLG' | 'SDR' | 'unknown';
  confidence: 'declared' | 'unknown';
  notes: string[];
}

const CODEC_PATTERN = /^(dvhe|dvh1|dav1|dva1|dvav)\.(\d{2})\.(\d{2})$/i;

function splitCodecList(value: string | string[] | null | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item) => item.split(','))
    .map((item) => item.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function parseCodecToken(
  raw: string,
  source: DolbyVisionDeclarationSource,
): DolbyVisionCodecDeclaration | null {
  const match = CODEC_PATTERN.exec(raw);
  if (!match) return null;
  const codec = match[1].toLowerCase() as DolbyVisionCodecDeclaration['codec'];
  const profile = Number(match[2]);
  const level = Number(match[3]);
  if (!Number.isInteger(profile) || profile < 0 || profile > 20 || !Number.isInteger(level) || level <= 0) return null;
  const family: DolbyVisionCodecFamily =
    codec === 'dvhe' || codec === 'dvh1' ? 'hevc'
      : codec === 'dav1' ? 'av1'
        : codec === 'dva1' || codec === 'dvav' ? 'avc' : 'unknown';
  return { raw, codec, profile, level, family, source };
}

function parseAttributeList(line: string): Record<string, string> {
  const colon = line.indexOf(':');
  const input = colon >= 0 ? line.slice(colon + 1) : line;
  const attributes: Record<string, string> = {};
  const expression = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(input)) !== null) {
    const raw = match[2].trim();
    attributes[match[1]] = raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1).replace(/\\(["\\])/g, '$1')
      : raw;
  }
  return attributes;
}

function detectContainer(url?: string | null, mimeType?: string | null): DolbyVisionFormatReport['container'] {
  const mime = (mimeType ?? '').toLowerCase().split(';')[0].trim();
  if (mime.includes('mpegurl')) return 'hls';
  if (mime === 'video/mp4' || mime === 'video/iso.segment') return 'mp4';
  if (mime === 'video/mp2t') return 'mpeg-ts';
  const path = (url ?? '').split(/[?#]/, 1)[0].toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  if (/\.(?:mp4|m4v|m4s)$/.test(path)) return 'mp4';
  if (/\.(?:ts|m2ts)$/.test(path)) return 'mpeg-ts';
  return 'unknown';
}

function parseVideoRange(manifest?: string | null): DolbyVisionFormatReport['videoRange'] {
  if (!manifest) return 'unknown';
  const values = new Set<DolbyVisionFormatReport['videoRange']>();
  for (const line of manifest.split(/\r?\n/).map((item) => item.trim())) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const range = parseAttributeList(line)['VIDEO-RANGE']?.toUpperCase();
    if (range === 'PQ' || range === 'HLG' || range === 'SDR') values.add(range);
  }
  return values.size === 1 ? [...values][0] : 'unknown';
}

/** Parse Dolby Vision declarations from HLS master playlist variant attributes. */
export function parseHlsDolbyVisionDeclarations(manifest: string): DolbyVisionCodecDeclaration[] {
  const declarations: DolbyVisionCodecDeclaration[] = [];
  for (const line of manifest.split(/\r?\n/).map((item) => item.trim())) {
    if (!line.startsWith('#EXT-X-STREAM-INF:') && !line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) continue;
    const attributes = parseAttributeList(line);
    for (const token of splitCodecList(attributes.CODECS)) {
      const parsed = parseCodecToken(token, 'codecs');
      if (parsed) declarations.push(parsed);
    }
    for (const token of splitCodecList(attributes['SUPPLEMENTAL-CODECS'])) {
      // Supplemental codec entries may include a codec/compatibility suffix.
      // Only the exact Dolby Vision codec identifier is accepted.
      const candidate = token.split('/')[0].trim();
      const parsed = parseCodecToken(candidate, 'supplemental-codecs');
      if (parsed) declarations.push(parsed);
    }
  }
  return deduplicateDeclarations(declarations);
}

function deduplicateDeclarations(
  declarations: DolbyVisionCodecDeclaration[],
): DolbyVisionCodecDeclaration[] {
  const seen = new Set<string>();
  return declarations.filter((item) => {
    const key = [item.raw.toLowerCase(), item.source, item.profile, item.level].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Detect declared Dolby Vision format hints; this is not a decoder capability probe. */
export function inspectDolbyVisionFormat(input: DolbyVisionFormatInput): DolbyVisionFormatReport {
  const declarations = [
    ...splitCodecList(input.codecs).flatMap((token) => {
      const parsed = parseCodecToken(token, 'codecs');
      return parsed ? [parsed] : [];
    }),
    ...splitCodecList(input.supplementalCodecs).flatMap((token) => {
      const parsed = parseCodecToken(token.split('/')[0].trim(), 'supplemental-codecs');
      return parsed ? [parsed] : [];
    }),
    ...(input.manifest ? parseHlsDolbyVisionDeclarations(input.manifest) : []),
  ];
  const unique = deduplicateDeclarations(declarations);
  const profiles = [...new Set(unique.map((item) => item.profile))].sort((a, b) => a - b);
  const levels = [...new Set(unique.map((item) => item.level))].sort((a, b) => a - b);
  const codecFamilies = [...new Set(unique.map((item) => item.family))];
  const notes: string[] = [];
  if (unique.length) {
    notes.push('检测到 Dolby Vision codec 声明；这不证明码流包含有效 RPU、设备完成解码或显示器正在输出 Dolby Vision。');
  } else {
    notes.push('未发现可识别的 Dolby Vision codec 声明；未知或未暴露的元数据不能据此判定内容一定不含 Dolby Vision。');
  }
  const videoRange = parseVideoRange(input.manifest);
  if (videoRange === 'PQ' || videoRange === 'HLG') {
    notes.push(`HLS 声明 VIDEO-RANGE=${videoRange}；该字段本身不是 Dolby Vision 证明。`);
  }
  if (profiles.length > 1) notes.push('检测到多个 Dolby Vision Profile 声明；请按实际变体分别评估，不要合并成单一播放能力结论。');

  return {
    container: detectContainer(input.url, input.mimeType),
    detected: unique.length > 0,
    declarations: unique,
    profiles,
    levels,
    codecFamilies,
    videoRange,
    confidence: unique.length ? 'declared' : 'unknown',
    notes,
  };
}
