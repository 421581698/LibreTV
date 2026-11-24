import { describe, expect, it } from 'vitest';
import {
  ATMOS_DISCLAIMER,
  buildDiagnosticsView,
  hasAtmosSignal,
} from './audio-diagnostics-view';
import type { PlaybackDiagnostics } from './playback-diagnostics';

function jocSnapshot(): PlaybackDiagnostics {
  return {
    format: {
      container: 'hls',
      audioCodec: 'eac3',
      dolbyFamily: 'dolby-atmos-metadata',
      confidence: 'declared',
      hasJocMarker: true,
    },
    audio: { renditionCount: 2, maxChannels: 6, hasJocMarker: true },
    capability: {
      browserFamily: 'safari',
      nativeDolbyDecode: 'unknown',
      bitstreamPassthrough: 'unknown',
      browserDecode: 'can-play-hint',
      atmosObjectDecode: 'not-established',
      safeDefault: 'native-media-playback',
    },
    stability: { health: 'healthy', peakStallMs: 180, peakDroppedFrameRatio: 0.01 },
  };
}

describe('audio diagnostics read-only view', () => {
  it('never claims Atmos decode even when JOC metadata is present', () => {
    const view = buildDiagnosticsView(jocSnapshot());
    expect(view.disclaimer).toBe(ATMOS_DISCLAIMER);
    expect(view.disclaimer).toContain('未验证');
    const cap = view.groups.find((g) => g.title === '能力探测（只读）');
    expect(cap?.rows.find((r) => r.label === 'Atmos 对象解码')?.value).toContain('未确立');
    expect(cap?.rows.find((r) => r.label === '原生 Dolby 解码')?.value).toContain('未验证');
    expect(cap?.rows.find((r) => r.label === '位流直通')?.value).toContain('未验证');
    for (const group of view.groups) {
      for (const item of group.rows) {
        expect(item.value).not.toMatch(/已(开启|启用|还原|支持 Atmos)/);
      }
    }
  });

  it('JOC marker surfaces as a caution signal, not a success indicator', () => {
    const view = buildDiagnosticsView(jocSnapshot());
    const format = view.groups.find((g) => g.title === '媒体格式');
    const joc = format?.rows.find((r) => r.label === 'JOC 标记');
    expect(joc?.value).toContain('仅为元数据线索');
    expect(joc?.tone).toBe('caution');
    expect(hasAtmosSignal(jocSnapshot())).toBe(true);
  });

  it('copy text carries enums and bounded numbers but no URL/token/rendition name', () => {
    const view = buildDiagnosticsView(jocSnapshot());
    expect(view.plainText).toContain('E-AC-3');
    expect(view.plainText).toContain('180 ms');
    expect(view.plainText).toContain('只读');
    expect(view.plainText).not.toContain('http');
    expect(view.plainText).not.toContain('token');
    expect(view.plainText).not.toContain('Czech');
  });

  it('has no Atmos signal for plain AAC stereo', () => {
    const plain: PlaybackDiagnostics = {
      format: { container: 'mp4', audioCodec: 'aac', dolbyFamily: 'none', confidence: 'declared', hasJocMarker: false },
      audio: { renditionCount: 1, maxChannels: 2, hasJocMarker: false },
      capability: null,
      stability: null,
    };
    expect(hasAtmosSignal(plain)).toBe(false);
    const view = buildDiagnosticsView(plain);
    expect(view.plainText).not.toContain('JOC 标记: 检测到');
  });

  it('renders a stable placeholder before any sample is collected', () => {
    const view = buildDiagnosticsView(null);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].rows[0].value).toContain('尚未采集');
    expect(view.plainText).toContain(ATMOS_DISCLAIMER);
  });
});
