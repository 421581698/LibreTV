'use client';

import type { DolbyVisionFormatReport } from '@/lib/dolby-vision/format-inspector';

interface DolbyVisionDiagnosticsPanelProps {
  report: DolbyVisionFormatReport | null;
}

/**
 * Read-only Dolby Vision status. Codec declarations are not proof of RPU
 * presence, successful Dolby Vision decoding, or display output.
 */
export default function DolbyVisionDiagnosticsPanel({ report }: DolbyVisionDiagnosticsPanelProps) {
  const declared = Boolean(report?.detected);
  const profileLabel = report?.profiles.length
    ? report.profiles.map((profile) => `Profile ${profile}`).join(' / ')
    : '未检测到可验证的 Profile 声明';

  return (
    <div className="absolute right-3 z-20 flex flex-col items-end" style={{ top: '6.25rem' }}>
      <details className="group">
        <summary
          className={`player-quality-badge cursor-pointer list-none ${declared ? 'border-amber-400/60 text-amber-200' : ''}`}
          aria-label="Dolby Vision 视频诊断（只读）"
        >
          Dolby Vision{declared ? ' · 已声明' : ' · 未知'}
        </summary>
        <div
          role="region"
          aria-label="Dolby Vision 视频诊断（只读）"
          className="mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/15 bg-black/92 p-3.5 text-white shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Dolby Vision 视频诊断</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">只读</span>
          </div>
          <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-[11px] leading-snug text-amber-200">
            Codec 声明不等于有效 RPU，也不代表浏览器已完成 Dolby Vision 解码或屏幕正在输出 Dolby Vision。
          </div>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-3">
              <span className="text-white/55">格式声明</span>
              <span className="text-right">{declared ? '检测到 Dolby Vision codec 声明' : '未确认'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">容器</span>
              <span>{report?.container ?? '未知'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">Profile</span>
              <span className="text-right">{profileLabel}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">视频范围声明</span>
              <span>{report?.videoRange ?? 'unknown'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">RPU / 动态元数据</span>
              <span>未验证</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">浏览器解码</span>
              <span>未验证</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">显示端 Dolby Vision 输出</span>
              <span>未验证</span>
            </div>
          </div>
          {report?.notes.map((note) => (
            <p key={note} className="mt-2 text-[10px] leading-snug text-white/50">{note}</p>
          ))}
        </div>
      </details>
    </div>
  );
}
