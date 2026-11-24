export type MediaContainer = 'hls' | 'mp4' | 'mkv' | 'webm' | 'mpeg-ts' | 'unknown';
export type AudioCodec = 'ac4' | 'eac3' | 'ac3' | 'truehd' | 'dolby-mat' | 'dts-x' | 'dts-hd' | 'dts' | 'aac' | 'iamf' | 'pcm' | 'opus' | 'flac' | 'alac' | 'unknown';
export type DolbyFamily = 'dolby-ac4' | 'dolby-digital' | 'dolby-digital-plus' | 'dolby-truehd' | 'dolby-mat' | 'dolby-atmos-metadata' | 'none' | 'unknown';

export interface Ac4CodecProfile { bitstreamVersion: number; presentationVersion: number; mdcompat: number; }

export interface MediaFormatInput {
  url?: string | null;
  mimeType?: string | null;
  codecs?: string | string[] | null;
  hlsChannels?: string | null;
  audioCodec?: string | null;
}

export interface MediaFormatReport {
  container: MediaContainer;
  audioCodec: AudioCodec;
  dolbyFamily: DolbyFamily;
  codecString: string | null;
  channelCount: number | null;
  hasJocMarker: boolean;
  ac4Profile: Ac4CodecProfile | null;
  confidence: 'declared' | 'inferred' | 'unknown';
  notes: string[];
}

function normalizeCodec(value: string): string {
  return value.trim().toLowerCase().replace(/^"|"$/g, '');
}

function parseChannels(raw?: string | null): { count: number | null; joc: boolean } {
  if (!raw) return { count: null, joc: false };
  const match = /^(\d+)(?:\/(.+))?$/.exec(raw.trim());
  const count = match ? Number(match[1]) : null;
  return {
    count: Number.isInteger(count) && count! > 0 ? count : null,
    joc: Boolean(match?.[2] && /(?:^|[^a-z])joc(?:$|[^a-z])/i.test(match[2])),
  };
}

function detectContainer(url?: string | null, mimeType?: string | null): MediaContainer {
  const mime = (mimeType ?? '').toLowerCase().split(';')[0].trim();
  if (mime.includes('mpegurl') || mime === 'application/vnd.apple.mpegurl') return 'hls';
  if (mime === 'video/mp4' || mime === 'audio/mp4') return 'mp4';
  if (mime === 'video/webm' || mime === 'audio/webm') return 'webm';
  if (mime === 'video/mp2t') return 'mpeg-ts';
  const path = (url ?? '').split(/[?#]/, 1)[0].toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  if (path.endsWith('.mp4') || path.endsWith('.m4v') || path.endsWith('.m4a')) return 'mp4';
  if (path.endsWith('.mkv')) return 'mkv';
  if (path.endsWith('.webm')) return 'webm';
  if (path.endsWith('.ts') || path.endsWith('.m2ts')) return 'mpeg-ts';
  return 'unknown';
}

function detectCodec(codecs: string[]): { codec: AudioCodec; source: string | null; family: DolbyFamily } {
  const rules: Array<[RegExp, AudioCodec, DolbyFamily]> = [
    [/(?:^|[.,\s])ac-4(?:$|[.,\s])|^ac4$/i, 'ac4', 'dolby-ac4'],
    [/(?:^|[.,\s])mlp(?:$|[.,\s])|truehd|mlpa/i, 'truehd', 'dolby-truehd'],
    [/\b(?:dolby[- ]?)?mat(?:\s?2(?:\.0|\.1)?)?\b/i, 'dolby-mat', 'dolby-mat'],
    [/(?:^|[.,\s])ec-3(?:$|[.,\s])|e-ac-?3|eac3/i, 'eac3', 'dolby-digital-plus'],
    [/(?:^|[.,\s])ac-3(?:$|[.,\s])|ac3/i, 'ac3', 'dolby-digital'],
    [/dts[- ]?x/i, 'dts-x', 'none'],
    [/dts-hd|dtshd|dts-hd ma/i, 'dts-hd', 'none'],
    [/(?:^|[.,\s])dts(?:$|[.,\s])|dca/i, 'dts', 'none'],
    [/\biamf(?:[.,\s]|$)/i, 'iamf', 'none'],
    [/\b(?:l?pcm|sowt|twos|in24|in32|fl32)\b/i, 'pcm', 'none'],
    [/mp4a|aac/i, 'aac', 'none'],
    [/opus/i, 'opus', 'none'],
    [/flac/i, 'flac', 'none'],
    [/alac/i, 'alac', 'none'],
  ];
  for (const value of codecs) {
    for (const [pattern, codec, family] of rules) {
      if (pattern.test(value)) return { codec, source: value, family };
    }
  }
  return { codec: 'unknown', source: codecs[0] ?? null, family: 'unknown' };
}

function parseAc4Profile(codecString: string | null): Ac4CodecProfile | null {
  if (!codecString) return null;
  const match = /^ac-4\.([0-9a-f]{2})\.([0-9a-f]{2})\.([0-9a-f]{2})$/i.exec(codecString.trim());
  if (!match) return null;
  return { bitstreamVersion: Number.parseInt(match[1], 16), presentationVersion: Number.parseInt(match[2], 16), mdcompat: Number.parseInt(match[3], 16) };
}

/** Detect declared media metadata; this is not a decoder or playback-support probe. */
export function detectMediaFormat(input: MediaFormatInput): MediaFormatReport {
  const codecValues = [
    ...(Array.isArray(input.codecs) ? input.codecs : input.codecs ? input.codecs.split(',') : []),
    ...(input.audioCodec ? [input.audioCodec] : []),
  ].map(normalizeCodec).filter(Boolean);
  const detected = detectCodec(codecValues);
  const channels = parseChannels(input.hlsChannels);
  const hasJocMarker = channels.joc || codecValues.some((value) => /(?:^|[-.,\s])joc(?:$|[-.,\s])/i.test(value));
  const ac4Profile = detected.codec === 'ac4' ? parseAc4Profile(detected.source) : null;
  const notes: string[] = [];

  if (hasJocMarker) notes.push('检测到 JOC 元数据标记；这不证明浏览器已解码 Atmos 对象。');
  if (channels.count === 6) notes.push('检测到六声道声明；仅凭声道数无法确认扬声器顺序或 5.1 布局。');
  if (detected.codec === 'ac4') notes.push(ac4Profile
    ? `检测到 Dolby AC-4 声明：mdcompat ${ac4Profile.mdcompat.toString(16).padStart(2, '0')}；这是源内容兼容级别，不证明当前设备支持 AC-4 解码或 Atmos 渲染。`
    : '检测到 Dolby AC-4 FourCC；未提供完整 codec profile，不能判断内容兼容级别或设备解码能力。');
  if (detected.codec === 'truehd') notes.push('TrueHD 仅被识别为码流/元数据提示；本模块不提供 TrueHD 解码或直通。');
  if (detected.codec === 'dolby-mat') notes.push('检测到 Dolby MAT 传输格式标记；MAT 是传输/封装线索，不证明浏览器解码或 HDMI 位流直通。');
  if (detected.codec === 'iamf') notes.push('检测到 IAMF 音频格式标记；不代表当前浏览器或设备支持其解码或空间渲染。');
  if (detected.codec === 'pcm') notes.push('检测到 PCM/LPCM 标记；不推断声道布局、采样格式或输出设备能力。');
  if (detected.codec === 'dts' || detected.codec === 'dts-hd' || detected.codec === 'dts-x') notes.push('DTS 格式识别不代表当前浏览器或设备支持解码。');
  if (detected.codec === 'eac3' || detected.codec === 'ac3') notes.push('Dolby 编码标识不等于 Atmos 对象解码能力。');

  const hasCodec = detected.codec !== 'unknown';
  return {
    container: detectContainer(input.url, input.mimeType),
    audioCodec: detected.codec,
    dolbyFamily: hasJocMarker ? 'dolby-atmos-metadata' : detected.family,
    codecString: detected.source,
    channelCount: channels.count,
    hasJocMarker,
    ac4Profile,
    confidence: hasCodec || channels.count !== null ? 'declared' : 'unknown',
    notes,
  };
}
