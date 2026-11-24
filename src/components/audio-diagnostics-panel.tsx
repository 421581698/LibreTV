'use client';

import { useState } from 'react';
import type { PlaybackDiagnostics } from '@/lib/playback-diagnostics';
import {
  buildDiagnosticsView,
  hasAtmosSignal,
  type DiagnosticsViewRow,
} from '@/lib/audio-diagnostics-view';

interface AudioDiagnosticsPanelProps {
  diagnostics: PlaybackDiagnostics | null;
}

const TONE_CLASS: Record<DiagnosticsViewRow['tone'], string> = {
  neutral: 'text-white/85',
  positive: 'text-emerald-300',
  caution: 'text-amber-300',
  unknown: 'text-white/55',
};

/**
 * Read-only diagnostics HUD. Shows what the player OBSERVED, never what it
 * claims to decode. Opening/copying this panel cannot change playback.
 */
export default function AudioDiagnosticsPanel({ diagnostics }: AudioDiagnosticsPanelProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const view = buildDiagnosticsView(diagnostics);
  const atmosSignal = hasAtmosSignal(diagnostics);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(view.plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="audio-diagnostics absolute right-3 z-20 flex flex-col items-end" style={{ top: '3.75rem' }}>
      <button
        type="button"
        className={`player-quality-badge ${atmosSignal ? 'border-amber-400/60 text-amber-200' : ''}`}
        aria-expanded={open}
        aria-label="音频与播放诊断（只读）"
        onClick={() => setOpen((value) => !value)}
      >
        音频诊断{atmosSignal ? ' · JOC 线索' : ''}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="音频与播放诊断（只读）"
          className="mt-2 w-[min(22rem,calc(100vw-2rem))] max-h-[min(70vh,34rem)] overflow-y-auto rounded-xl border border-white/15 bg-black/92 p-3.5 text-white shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">音频 / 播放诊断</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">只读 · 不自动处理</span>
          </div>

          <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-[11px] leading-snug text-amber-200">
            {view.disclaimer}
          </div>

          <div className="space-y-3">
            {view.groups.map((group) => (
              <div key={group.title}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">{group.title}</div>
                <div className="space-y-0.5">
                  {group.rows.map((item) => (
                    <div key={item.label} className="flex items-start justify-between gap-3 text-[11px]">
                      <span className="shrink-0 text-white/55">{item.label}</span>
                      <span className={`text-right ${TONE_CLASS[item.tone]}`}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-3 w-full rounded-lg border border-white/20 bg-white/10 py-1.5 text-xs font-medium transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => void copyReport()}
          >
            {copied ? '已复制诊断报告' : '复制诊断报告（发给开发者）'}
          </button>
          <p className="mt-1.5 text-[10px] leading-snug text-white/45">
            报告仅含枚举与有界数值，不含播放地址、令牌或音轨名称。
          </p>
        </div>
      )}
    </div>
  );
}
