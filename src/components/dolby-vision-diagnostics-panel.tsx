'use client';

import { useEffect, useRef, useState } from 'react';
import type { DolbyVisionFormatReport } from '@/lib/dolby-vision/format-inspector';
import { canAnalyzeDolbyVisionRpuAsset } from '@/lib/dolby-vision/rpu-analysis-eligibility';
import { parseVerifiedDolbyVisionEvidenceResponse, type VerifiedDolbyVisionEvidenceResponse } from '@/lib/dolby-vision/verified-evidence-response';

interface DolbyVisionDiagnosticsPanelProps {
  report: DolbyVisionFormatReport | null;
  sourceKind?: 'cms' | 'direct' | 'registry' | 'unknown';
  sourceIdentity?: string;
  /** Stable server-issued registry asset ID; never derive this from a playback URL. */
  assetId?: string;
}

/**
 * Read-only Dolby Vision status. Codec declarations are not proof of RPU
 * presence, successful Dolby Vision decoding, or display output.
 */
export default function DolbyVisionDiagnosticsPanel({ report, assetId, sourceKind = 'unknown', sourceIdentity }: DolbyVisionDiagnosticsPanelProps) {
  const declared = Boolean(report?.detected);
  const canAnalyzeRpu = canAnalyzeDolbyVisionRpuAsset(assetId, report);
  const profileLabel = report?.profiles.length
    ? report.profiles.map((profile) => `Profile ${profile}`).join(' / ')
    : '未检测到可验证的 Profile 声明';
  const [verifiedEvidence, setVerifiedEvidence] = useState<{ assetId: string; evidence: VerifiedDolbyVisionEvidenceResponse } | null>(null);
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [analysisError, setAnalysisError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  // Hide evidence synchronously on the render where the asset changes; the effect below
  // performs cleanup, but effects run after paint and alone permit one stale render.
  const currentVerifiedEvidence = verifiedEvidence && verifiedEvidence.assetId === assetId
    ? verifiedEvidence.evidence
    : null;

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
        setVerifiedEvidence({ assetId, evidence: parsed });
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
          className={`player-quality-badge flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${declared ? 'border-amber-400/70 bg-amber-950/90 text-amber-100' : 'border-white/25 bg-black/90 text-white'}`}
          aria-label="打开 Dolby Vision 视频诊断面板"
          title="查看 Dolby Vision 格式、RPU 与显示链路验证状态"
        >
          <span aria-hidden="true" className="text-base leading-none text-amber-300">◈</span>
          <span>Dolby Vision 诊断</span>
          <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-medium text-white/80">
            {declared ? '已声明' : '待确认'}
          </span>
          <span aria-hidden="true" className="text-white/60">⌄</span>
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
              <span className="text-white/55">资源来源</span>
              <span className="text-right">{sourceKind === 'cms' ? 'CMS / 聚合 API' : sourceKind === 'direct' ? '直接媒体地址' : sourceKind === 'registry' ? '可信资源登记' : '普通播放源'}</span>
            </div>
            {sourceIdentity && (
              <div className="flex justify-between gap-3">
                <span className="text-white/55">来源标识</span>
                <span className="max-w-[13rem] truncate text-right" title={sourceIdentity}>{sourceIdentity}</span>
              </div>
            )}
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
              <span className="text-white/55">RPU 存在性</span>
              <span>{currentVerifiedEvidence ? '已验证存在' : '未验证'}</span>
            </div>
            {currentVerifiedEvidence && (
              <>
                <div className="flex justify-between gap-3">
                  <span className="text-white/55">可信分析来源</span>
                  <span>dovi_tool · 完整媒体</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-white/55">RPU Profile</span>
                  <span>{currentVerifiedEvidence.evidence.profile === null ? '多 Profile / 未唯一归属' : currentVerifiedEvidence.evidence.profile}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-white/55">分析帧数</span>
                  <span>{currentVerifiedEvidence.evidence.frameCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-white/55">动态元数据层</span>
                  <span>{currentVerifiedEvidence.evidence.metadataLevels.join(' / ') || '未检出'}</span>
                </div>
              </>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-white/55">帧级动态元数据</span>
              <span className="text-right">
                {currentVerifiedEvidence
                  ? currentVerifiedEvidence.evidence.metadataLevels.some((level) => level === 1 || level === 2)
                    ? '已验证 L1/L2'
                    : 'RPU 已存在，动态元数据未确认'
                  : '未验证'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">Dolby Vision 专用解码器</span>
              <span className="text-right">LibreTV 尚未集成</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">RPU 驱动动态渲染</span>
              <span>尚未集成</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">系统原生解码状态</span>
              <span>当前网页无法确认</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">显示端 Dolby Vision 输出</span>
              <span>需要真机与输出链路验证</span>
            </div>
          </div>
          {canAnalyzeRpu && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <button
                type="button"
                disabled={analysisState === 'loading'}
                onClick={analyzeRegisteredAsset}
                className="w-full rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/20 disabled:cursor-wait disabled:opacity-60"
              >
                {analysisState === 'loading' ? '正在进行可信 RPU 分析…' : currentVerifiedEvidence ? '重新验证媒体 RPU' : '验证此媒体的 RPU'}
              </button>
              {analysisError && <p role="alert" className="mt-2 text-[10px] text-amber-200">{analysisError}</p>}
              {currentVerifiedEvidence && <p className="mt-2 text-[10px] text-emerald-200">服务端签名和媒体 SHA-256 均已验证。</p>}
            </div>
          )}
          {!assetId && (
            <div className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-snug text-white/55">
              <p className="font-semibold text-amber-200">未绑定可信媒体资产</p>
              <p className="mt-1">{sourceKind === 'cms'
                ? '当前播放源是 CMS 聚合 API。影片 ID、标题和 API 地址都不是媒体资产身份；必须先由已验证的直接媒体候选完成公开访问验证、实际播放确认、授权来源获取及 SHA-256 入库，才能绑定 RPU 分析。'
                : '当前播放源尚未绑定服务端签发的可信媒体资产 ID，因此不能执行 RPU 验证。'} </p>
              <p className="mt-1">不会根据影片标题、CMS ID 或播放 URL 自动建立可信绑定。</p>
            </div>
          )}
          {assetId && report?.container === 'mp4' && !canAnalyzeRpu && (
            <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-snug text-white/45">
              {report.codecFamilies.includes('av1')
                ? '当前检测到 AV1 Dolby Vision 声明；已有独立的 OBU 结构检查基础，但 Dolby T.35 Provider/EMDF 识别、RPU 提取和签名证据尚未完成，不能交给 HEVC 解析器处理。'
                : '当前 MP4 未能确认是单一 HEVC 视频编码；服务端 RPU 分析目前仅支持 MP4 + 单一 HEVC 视频轨道。'}
            </p>
          )}
          {assetId && report?.container !== 'mp4' && (
            <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-snug text-white/45">
              当前媒体已绑定不可变资产 ID；服务端 RPU 分析目前仅支持 MP4 + HEVC，HLS/WebM 的 RPU 分析保持未验证。
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
