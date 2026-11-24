'use client';

import { useEffect, useRef, useState } from 'react';
import type { DolbyVisionFormatReport } from '@/lib/dolby-vision/format-inspector';
import { parseVerifiedDolbyVisionEvidenceResponse, type VerifiedDolbyVisionEvidenceResponse } from '@/lib/dolby-vision/verified-evidence-response';

interface DolbyVisionDiagnosticsPanelProps {
  report: DolbyVisionFormatReport | null;
  /** Stable server-issued registry asset ID; never derive this from a playback URL. */
  assetId?: string;
}

/**
 * Read-only Dolby Vision status. Codec declarations are not proof of RPU
 * presence, successful Dolby Vision decoding, or display output.
 */
export default function DolbyVisionDiagnosticsPanel({ report, assetId }: DolbyVisionDiagnosticsPanelProps) {
  const declared = Boolean(report?.detected);
  const profileLabel = report?.profiles.length
    ? report.profiles.map((profile) => `Profile ${profile}`).join(' / ')
    : '未检测到可验证的 Profile 声明';
  const [verifiedEvidence, setVerifiedEvidence] = useState<VerifiedDolbyVisionEvidenceResponse | null>(null);
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [analysisError, setAnalysisError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setVerifiedEvidence(null);
    setAnalysisState('idle');
    setAnalysisError('');
    return () => requestRef.current?.abort();
  }, [assetId]);

  async function analyzeRegisteredAsset() {
    if (!assetId || !/^[A-Za-z0-9:_-]{1,200}$/.test(assetId) || analysisState === 'loading') return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setAnalysisState('loading');
    setAnalysisError('');
    setVerifiedEvidence(null);
    try {
      const response = await fetch(`/api/dolby-vision/assets/${encodeURIComponent(assetId)}/analyze`, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = parseVerifiedDolbyVisionEvidenceResponse(payload, assetId);
      if (!response.ok || !parsed) {
        throw new Error(response.status === 503
          ? '可信分析服务尚未配置或当前账户不可用'
          : response.status === 404
            ? '资产不存在或尚未完成媒体入库'
            : '分析失败或签名证据校验未通过');
      }
      if (!controller.signal.aborted) {
        setVerifiedEvidence(parsed);
        setAnalysisState('idle');
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnalysisError(error instanceof Error ? error.message : '分析服务暂不可用');
      setAnalysisState('error');
    }
  }

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
              <span>{verifiedEvidence
                ? verifiedEvidence.evidence.rpuPresent ? '已验证存在' : '已验证未检测到'
                : '未验证'}</span>
            </div>
            {verifiedEvidence && (
              <>
                <div className="flex justify-between gap-3">
                  <span className="text-white/55">可信分析来源</span>
                  <span>dovi_tool · 完整媒体</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-white/55">RPU Profile</span>
                  <span>{verifiedEvidence.evidence.profile === null ? '多 Profile / 未唯一归属' : verifiedEvidence.evidence.profile}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-white/55">分析帧数</span>
                  <span>{verifiedEvidence.evidence.frameCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-white/55">动态元数据层</span>
                  <span>{verifiedEvidence.evidence.metadataLevels.join(' / ') || '未检出'}</span>
                </div>
              </>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-white/55">浏览器解码</span>
              <span>未验证</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">显示端 Dolby Vision 输出</span>
              <span>未验证</span>
            </div>
          </div>
          {assetId && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <button
                type="button"
                disabled={analysisState === 'loading'}
                onClick={analyzeRegisteredAsset}
                className="w-full rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/20 disabled:cursor-wait disabled:opacity-60"
              >
                {analysisState === 'loading' ? '正在进行可信 RPU 分析…' : verifiedEvidence ? '重新验证媒体 RPU' : '验证此媒体的 RPU'}
              </button>
              {analysisError && <p role="alert" className="mt-2 text-[10px] text-amber-200">{analysisError}</p>}
              {verifiedEvidence && <p className="mt-2 text-[10px] text-emerald-200">服务端签名和媒体 SHA-256 均已验证。</p>}
            </div>
          )}
          {!assetId && (
            <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-snug text-white/45">
              当前播放源尚未绑定可信媒体资产 ID，因此不能执行 RPU 验证。
            </p>
          )}
          {report?.notes.map((note) => (
            <p key={note} className="mt-2 text-[10px] leading-snug text-white/50">{note}</p>
          ))}
        </div>
      </details>
    </div>
  );
}
