/**
 * Human-readable, read-only view of the telemetry-safe playback diagnostics.
 *
 * This module is a PURE formatter: it consumes the already-sanitized
 * PlaybackDiagnostics snapshot and turns it into labeled rows plus a plain-text
 * report that the user can copy from the device for manual verification.
 *
 * Hard rules (Phase 1 / read-only):
 *  - No playback decision, no callback, no side effect. Formatting only.
 *  - Never claims Dolby Atmos object decode, native Dolby decode or bitstream
 *    passthrough. JOC / Dolby metadata is shown strictly as a *signal*.
 *  - Never emits media URLs, tokens, rendition names or free-form notes — the
 *    input is already whitelisted, and this module only reads known fields.
 */

import type {
  PlaybackDiagnostics,
  FormatDiagnostics,
  AudioDiagnostics,
  CapabilityDiagnostics,
  StabilityDiagnostics,
} from './playback-diagnostics';

export interface DiagnosticsViewRow {
  label: string;
  value: string;
  /** Semantic hint for the panel; never changes playback behaviour. */
  tone: 'neutral' | 'positive' | 'caution' | 'unknown';
}

export interface DiagnosticsViewGroup {
  title: string;
  rows: DiagnosticsViewRow[];
}

export interface DiagnosticsView {
  groups: DiagnosticsViewGroup[];
  /** Fixed disclaimer shown verbatim above the report. */
  disclaimer: string;
  /** Plain text for clipboard copy; contains no URLs/tokens/free-form data. */
  plainText: string;
}

export const ATMOS_DISCLAIMER =
  '杜比全景声（Atmos）对象解码 / 原生 Dolby 解码 / 位流直通均未验证。' +
  'JOC 或 Dolby 元数据仅代表音轨中检测到相关标记，不等于设备已还原 Atmos 声场。';

const CONTAINER_LABELS: Record<string, string> = {
  hls: 'HLS 流',
  mp4: 'MP4',
  mkv: 'MKV',
  webm: 'WebM',
  'mpeg-ts': 'MPEG-TS',
  unknown: '未知',
};

const CODEC_LABELS: Record<string, string> = {
  ac4: 'Dolby AC-4',
  eac3: 'E-AC-3 / Dolby Digital Plus',
  ac3: 'AC-3 / Dolby Digital',
  truehd: 'Dolby TrueHD',
  'dolby-mat': 'Dolby MAT（传输格式标记）',
  iamf: 'IAMF',
  pcm: 'PCM / LPCM',
  'dts-x': 'DTS:X',
  'dts-hd': 'DTS-HD',
  dts: 'DTS',
  aac: 'AAC',
  opus: 'Opus',
  flac: 'FLAC',
  alac: 'Apple Lossless',
  unknown: '未知',
};

const DOLBY_LABELS: Record<string, string> = {
  'dolby-ac4': 'Dolby AC-4',
  'dolby-digital': 'Dolby Digital（有损 5.1）',
  'dolby-digital-plus': 'Dolby Digital Plus',
  'dolby-truehd': 'Dolby TrueHD（无损）',
  'dolby-mat': 'Dolby MAT（传输格式标记）',
  'dolby-atmos-metadata': '检测到 Atmos 元数据标记（非对象解码）',
  none: '未检测到 Dolby 家族',
  unknown: '未知',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  declared: '由源站声明',
  inferred: '由线索推断',
  unknown: '未知',
};

const BROWSER_LABELS: Record<string, string> = {
  safari: 'Safari',
  chromium: 'Chromium',
  firefox: 'Firefox',
  other: '其他浏览器',
  unknown: '未知',
};

const BROWSER_DECODE_LABELS: Record<string, string> = {
  'not-probed': '未探测',
  'can-play-hint': '浏览器 canPlayType 提示可播（非解码证明）',
  'cannot-play-hint': '浏览器 canPlayType 提示不可播',
};

const HEALTH_LABELS: Record<string, string> = {
  healthy: '健康',
  'low-buffer': '缓冲偏低',
  buffering: '缓冲中',
  stalled: '卡顿',
  offline: '离线',
  degraded: '降级',
  unknown: '未知',
};

function row(label: string, value: string, tone: DiagnosticsViewRow['tone']): DiagnosticsViewRow {
  return { label, value, tone };
}

function formatGroup(diag: PlaybackDiagnostics): DiagnosticsViewGroup | null {
  const format: FormatDiagnostics | null = diag.format;
  if (!format) return null;
  const jocTone: DiagnosticsViewRow['tone'] = format.hasJocMarker ? 'caution' : 'unknown';
  return {
    title: '媒体格式',
    rows: [
      row('容器', CONTAINER_LABELS[format.container] ?? '未知', 'neutral'),
      row('音频编码', CODEC_LABELS[format.audioCodec] ?? '未知', format.audioCodec === 'unknown' ? 'unknown' : 'neutral'),
      row('Dolby 家族', DOLBY_LABELS[format.dolbyFamily] ?? '未知',
        format.dolbyFamily === 'dolby-atmos-metadata' ? 'caution' : 'neutral'),
      row('判断依据', CONFIDENCE_LABELS[format.confidence] ?? '未知', 'neutral'),
      row('JOC 标记', format.hasJocMarker ? '检测到（仅为元数据线索）' : '未检测到',
        jocTone),
      ...(format.ac4Profile ? [row(
        'AC-4 源声明级别',
        `mdcompat ${format.ac4Profile.mdcompat.toString(16).padStart(2, '0')} · ${format.ac4Profile.mdcompat >= 2 ? '沉浸式兼容级别' : format.ac4Profile.mdcompat === 1 ? '多声道兼容级别' : format.ac4Profile.mdcompat === 0 ? '立体声兼容级别' : '未知兼容级别'}（非设备解码证明）`,
        'caution' as const,
      )] : []),
    ],
  };
}

function audioGroup(diag: PlaybackDiagnostics): DiagnosticsViewGroup | null {
  const audio: AudioDiagnostics | null = diag.audio;
  if (!audio) return null;
  return {
    title: '音轨（hls.js 实测）',
    rows: [
      row('音轨数量', String(audio.renditionCount), 'neutral'),
      row('最大声道数', audio.maxChannels === null ? '未知' : String(audio.maxChannels),
        audio.maxChannels === null ? 'unknown' : 'neutral'),
      row('JOC 标记', audio.hasJocMarker ? '音轨中检测到（非 Atmos 证明）' : '未检测到',
        audio.hasJocMarker ? 'caution' : 'unknown'),
    ],
  };
}

function capabilityGroup(diag: PlaybackDiagnostics): DiagnosticsViewGroup | null {
  const cap: CapabilityDiagnostics | null = diag.capability;
  if (!cap) return null;
  return {
    title: '能力探测（只读）',
    rows: [
      row('浏览器', BROWSER_LABELS[cap.browserFamily] ?? '未知', 'neutral'),
      row('原生 Dolby 解码', '未验证（unknown）', 'unknown'),
      row('位流直通', '未验证（unknown）', 'unknown'),
      row('Atmos 对象解码', '未确立（not-established）', 'unknown'),
      row('浏览器解码提示', BROWSER_DECODE_LABELS[cap.browserDecode] ?? '未探测',
        cap.browserDecode === 'not-probed' ? 'unknown' : 'neutral'),
      row('默认播放路径', '浏览器原生媒体播放', 'positive'),
    ],
  };
}

function stabilityGroup(diag: PlaybackDiagnostics): DiagnosticsViewGroup | null {
  const stability: StabilityDiagnostics | null = diag.stability;
  if (!stability) return null;
  const healthTone: DiagnosticsViewRow['tone'] =
    stability.health === 'healthy' ? 'positive'
      : stability.health === 'unknown' ? 'unknown' : 'caution';
  return {
    title: '播放稳定性（只读）',
    rows: [
      row('健康状态', HEALTH_LABELS[stability.health] ?? '未知', healthTone),
      row('峰值卡顿', `${stability.peakStallMs} ms`, stability.peakStallMs > 0 ? 'caution' : 'neutral'),
      row('峰值丢帧率', stability.peakDroppedFrameRatio === null
        ? '未知'
        : `${(stability.peakDroppedFrameRatio * 100).toFixed(1)}%`,
        stability.peakDroppedFrameRatio === null ? 'unknown' : 'neutral'),
    ],
  };
}

function toPlainText(view: Omit<DiagnosticsView, 'plainText'>): string {
  const lines: string[] = ['[LibreTV 音频/播放诊断]', ATMOS_DISCLAIMER, ''];
  for (const group of view.groups) {
    lines.push(`【${group.title}】`);
    for (const item of group.rows) {
      lines.push(`  ${item.label}: ${item.value}`);
    }
    lines.push('');
  }
  lines.push('诊断模式：只读（不自动换源 / 不降画质 / 不重启）');
  return lines.join('\n').trimEnd();
}

/**
 * Build the full read-only diagnostics view from a PlaybackDiagnostics snapshot.
 * Returns a stable empty report when the snapshot is not available yet.
 */
export function buildDiagnosticsView(diag: PlaybackDiagnostics | null | undefined): DiagnosticsView {
  const groups: DiagnosticsViewGroup[] = [];
  if (diag) {
    const format = formatGroup(diag);
    const audio = audioGroup(diag);
    const capability = capabilityGroup(diag);
    const stability = stabilityGroup(diag);
    if (format) groups.push(format);
    if (audio) groups.push(audio);
    if (capability) groups.push(capability);
    if (stability) groups.push(stability);
  }
  if (groups.length === 0) {
    groups.push({
      title: '状态',
      rows: [row('诊断数据', '尚未采集到播放样本，请先开始播放', 'unknown')],
    });
  }
  const base = { groups, disclaimer: ATMOS_DISCLAIMER };
  return { ...base, plainText: toPlainText(base) };
}

/**
 * True only when a JOC marker or Atmos metadata was detected — used to tint the
 * badge amber. This is explicitly NOT an Atmos "working" indicator.
 */
export function hasAtmosSignal(diag: PlaybackDiagnostics | null | undefined): boolean {
  if (!diag) return false;
  return diag.format?.hasJocMarker === true
    || diag.format?.dolbyFamily === 'dolby-atmos-metadata'
    || diag.audio?.hasJocMarker === true;
}
