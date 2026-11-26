/**
 * Cinema HDR capability and routing contract.
 * HLS attributes are declarations, not proof of decoded pixels, 10-bit output,
 * dynamic HDR10+ metadata processing or a certified Dolby Vision display path.
 */
export type CinemaTransfer = 'pq' | 'hlg' | 'sdr' | 'unknown';
export type CinemaHdrFormat = 'dolby-vision' | 'hdr10-candidate' | 'hlg' | 'sdr' | 'unknown';
export type CinemaGamut = 'bt2020' | 'p3' | 'srgb' | 'unknown';
export type CinemaHdrOutput = 'native-hdr-candidate' | 'gpu-sdr-enhancement' | 'native-sdr' | 'unknown';

export interface CinemaHdrVariant {
  codec: string;
  transfer: CinemaTransfer;
  format: CinemaHdrFormat;
  /** A codec/profile declaration is not proof of an actual 10-bit output. */
  declaredBitDepth: 8 | 10 | 12 | null;
  colorGamut: CinemaGamut;
  hdr10Plus: 'unverified';
  dynamicMetadataOutput: 'unverified';
}
export interface CinemaHdrReport {
  variants: CinemaHdrVariant[];
  hdrDeclared: boolean;
  displayHdrHint: 'high' | 'standard' | 'unknown';
  displayGamutHint: CinemaGamut;
  selectedOutput: CinemaHdrOutput;
  actualHdrOutput: 'unverified';
  actualBitDepth: 'unverified';
  notes: string[];
}
export interface CinemaHdrLevel {
  videoCodec?: string | null;
  attrs?: unknown;
}
export interface CinemaHdrProbe {
  nativeHlsSupport: string;
  userAgent: string;
  canPlayVideoCodec: (codec: string) => string;
  matchMedia?: (query: string) => { matches: boolean };
  qualityPreference: string;
  playbackStarted: boolean;
  alreadyAttemptedNative: boolean;
}
const DV_CODEC = /^(?:dvhe|dvh1|dav1|dva1|dvav)\./i;
const HEVC_CODEC = /^(?:hvc1|hev1)\./i;
const AV1_CODEC = /^av01\./i;
const HDR10_PLUS_NOTE = 'HDR10+ 动态元数据必须由真实码流分析及设备验证；PQ 声明不能证明 HDR10+。';
function tokens(value: string): string[] {
  return value.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
}
function attrMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string,string] => typeof entry[1] === 'string'));
}
function parseManifestAttrs(line: string): Record<string,string> {
  const attrs: Record<string,string> = {};
  const raw = line.slice(line.indexOf(':') + 1);
  const regexp = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regexp.exec(raw))) {
    attrs[match[1]] = match[2].startsWith('"') ? match[2].slice(1,-1) : match[2];
  }
  return attrs;
}
function manifestVariants(manifest: string): Array<Record<string,string>> {
  return manifest.split(/\r?\n/)
    .filter(line => line.startsWith('#EXT-X-STREAM-INF:'))
    .map(parseManifestAttrs);
}
function declaredDepth(codec: string): 8 | 10 | 12 | null {
  const av1 = /^av01\.\d+\.\d+[MH]\.([0-9]{2})/i.exec(codec);
  if (av1) return Number(av1[1]) === 8 ? 8 : Number(av1[1]) === 10 ? 10 : Number(av1[1]) === 12 ? 12 : null;
  // Main10 HEVC profile permits 10-bit decoding, but cannot confirm actual bit depth.
  if (/^(?:hev1|hvc1)\.2\./i.test(codec)) return 10;
  return null;
}
export function inspectCinemaHdrVariants(
  levels: readonly CinemaHdrLevel[] = [], manifest?: string,
): CinemaHdrVariant[] {
  const attrsList = manifest ? manifestVariants(manifest) :
    levels.map(level => ({ ...attrMap(level.attrs), CODECS: attrMap(level.attrs).CODECS || level.videoCodec || '' }));
  return attrsList.map(attrs => {
    const all = [...tokens(attrs.CODECS || ''), ...tokens(attrs['SUPPLEMENTAL-CODECS'] || '').map(s => s.split('/')[0])];
    const codec = all.find(s => DV_CODEC.test(s)) ?? all.find(s => HEVC_CODEC.test(s) || AV1_CODEC.test(s)) ?? all[0] ?? '';
    const range = (attrs['VIDEO-RANGE'] || '').toUpperCase();
    const transfer: CinemaTransfer = range === 'PQ' ? 'pq' : range === 'HLG' ? 'hlg' : range === 'SDR' ? 'sdr' : 'unknown';
    const dv = all.some(s => DV_CODEC.test(s));
    const format: CinemaHdrFormat = dv ? 'dolby-vision' : transfer === 'hlg' ? 'hlg' :
      transfer === 'pq' ? 'hdr10-candidate' : transfer === 'sdr' ? 'sdr' : 'unknown';
    // Standard HLS VIDEO-RANGE is a transfer declaration, not a wide-gamut
    // descriptor; do not infer BT.2020 or P3 from PQ/HLG alone.
    return { codec, transfer, format, declaredBitDepth: declaredDepth(codec),
      colorGamut: 'unknown', hdr10Plus: 'unverified', dynamicMetadataOutput: 'unverified' };
  });
}
function queryHint(matchMedia: CinemaHdrProbe['matchMedia'], query: string): boolean | null {
  if (!matchMedia) return null;
  try { return Boolean(matchMedia(query).matches); } catch { return null; }
}
export function isSafariNativeHdrCandidate(variants: readonly CinemaHdrVariant[], options: CinemaHdrProbe): boolean {
  if (options.qualityPreference !== 'auto' || options.playbackStarted || options.alreadyAttemptedNative) return false;
  if (!['maybe','probably'].includes(options.nativeHlsSupport)) return false;
  const ua = options.userAgent;
  if (!/AppleWebKit\/\d/.test(ua) || !/Safari\/\d/.test(ua) ||
      /(?:Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|OPiOS|SamsungBrowser)\//.test(ua)) return false;
  return variants.some(v => {
    if (!['pq','hlg'].includes(v.transfer) || !v.codec) return false;
    try { return ['maybe','probably'].includes(options.canPlayVideoCodec(v.codec)); }
    catch { return false; }
  });
}
export function assessCinemaHdr(
  variants: readonly CinemaHdrVariant[], options: CinemaHdrProbe,
  gpuEnhancementActive = false,
): CinemaHdrReport {
  const high = queryHint(options.matchMedia, '(dynamic-range: high)');
  const standard = queryHint(options.matchMedia, '(dynamic-range: standard)');
  const displayHdrHint = high === true ? 'high' : standard === true ? 'standard' : 'unknown';
  const gamut: CinemaGamut = queryHint(options.matchMedia, '(color-gamut: rec2020)') === true ? 'bt2020'
    : queryHint(options.matchMedia, '(color-gamut: p3)') === true ? 'p3'
    : queryHint(options.matchMedia, '(color-gamut: srgb)') === true ? 'srgb' : 'unknown';
  const hdrDeclared = variants.some(v => v.transfer === 'pq' || v.transfer === 'hlg' || v.format === 'dolby-vision');
  const nativeCandidate = isSafariNativeHdrCandidate(variants, options);
  return {
    variants: [...variants], hdrDeclared, displayHdrHint, displayGamutHint: gamut,
    selectedOutput: nativeCandidate ? 'native-hdr-candidate' : gpuEnhancementActive ? 'gpu-sdr-enhancement'
      : hdrDeclared ? 'unknown' : variants.length ? 'native-sdr' : 'unknown',
    actualHdrOutput: 'unverified', actualBitDepth: 'unverified',
    notes: [
      HDR10_PLUS_NOTE,
      'HDR10/PQ、HLG、Dolby Vision、广色域及 10-bit 输出均需原生播放设备实测；浏览器 API 只提供能力提示。',
      'GPU 增强只在可读取媒体帧时运行，普通 SDR 的增强结果不等于原生 HDR 或 Dolby Vision。',
    ],
  };
}
