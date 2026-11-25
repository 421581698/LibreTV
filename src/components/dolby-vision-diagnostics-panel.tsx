'use client';

import { useEffect, useRef, useState } from 'react';
import type { DolbyVisionFormatReport } from '@/lib/dolby-vision/format-inspector';
import { probeNativeDolbyVisionCapabilities, type DolbyVisionNativeCapabilityReport } from '@/lib/dolby-vision/native-playback-capability';
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
  const [browserCapabilityState, setBrowserCapabilityState] = useState<{ report: DolbyVisionFormatReport; capability: DolbyVisionNativeCapabilityReport } | null>(null);
  const browserCapability = browserCapabilityState?.report === report ? browserCapabilityState.capability : null;

  useEffect(() => {
    if (!report) {
      return;
    }
    const video = document.createElement('video');
    const capability = probeNativeDolbyVisionCapabilities(
      report,
      (mime) => video.canPlayType(mime),
      typeof window.matchMedia === 'function' ? (query) => window.matchMedia(query) : undefined,
    );
    setBrowserCapabilityState({ report, capability });
  }, [report]);

  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [analysisError, setAnalysisError] = useState('');
  const [hlsGraph, setHlsGraph] = useState<{ resourceId: string; memberCount: number; playlistCount: number; initializationCount: number; segmentCount: number; variantAssetIds: string[] } | null>(null);
  const [hlsGraphState, setHlsGraphState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [hlsGraphError, setHlsGraphError] = useState('');
  const [hlsAnalysisState, setHlsAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [hlsAnalysisError, setHlsAnalysisError] = useState('');
  const [hlsEvidence, setHlsEvidence] = useState<{
    resourceId: string;
    variantAssetId: string;
    profile: number | null;
    frameCount: number;
    metadataLevels: number[];
    graphSha256: string;
  } | null>(null);
  const [hlsSegmentAnalysisState, setHlsSegmentAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [hlsSegmentAnalysisError, setHlsSegmentAnalysisError] = useState('');
  const [hlsSegmentEvidence, setHlsSegmentEvidence] = useState<{
    resourceId: string;
    variantAssetId: string;
    segmentCount: number;
    totalRpuFrameCount: number;
    rpuFrameAlignment: 'one-rpu-per-video-sample';
    metadataLevels: number[];
    graphSha256: string;
  } | null>(null);
  const hlsGraphRequestRef = useRef<AbortController | null>(null);
  const hlsAnalysisRequestRef = useRef<AbortController | null>(null);
  const hlsSegmentAnalysisRequestRef = useRef<AbortController | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  // Hide evidence synchronously on the render where the asset changes; the effect below
  // performs cleanup, but effects run after paint and alone permit one stale render.
  const currentVerifiedEvidence = verifiedEvidence && verifiedEvidence.assetId === assetId
    ? verifiedEvidence.evidence
    : null;
  const currentHlsEvidence = hlsEvidence && hlsEvidence.resourceId === sourceIdentity
    ? hlsEvidence
    : null;
  const currentHlsSegmentEvidence = hlsSegmentEvidence && hlsSegmentEvidence.resourceId === sourceIdentity
    ? hlsSegmentEvidence
    : null;

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setVerifiedEvidence(null);
    setAnalysisState('idle');
    setAnalysisError('');
    return () => requestRef.current?.abort();
  }, [assetId]);

  useEffect(() => {
    hlsGraphRequestRef.current?.abort();
    hlsGraphRequestRef.current = null;
    setHlsGraph(null);
    setHlsGraphError('');
    hlsAnalysisRequestRef.current?.abort();
    hlsAnalysisRequestRef.current = null;
    setHlsEvidence(null);
    setHlsAnalysisState('idle');
    setHlsAnalysisError('');
    hlsSegmentAnalysisRequestRef.current?.abort();
    hlsSegmentAnalysisRequestRef.current = null;
    setHlsSegmentEvidence(null);
    setHlsSegmentAnalysisState('idle');
    setHlsSegmentAnalysisError('');
    if (sourceKind !== 'registry' || report?.container !== 'hls' ||
        !sourceIdentity || !/^[a-z0-9_-]{1,80}$/i.test(sourceIdentity)) {
      setHlsGraphState('idle');
      return;
    }
    const controller = new AbortController();
    hlsGraphRequestRef.current = controller;
    setHlsGraphState('loading');
    void fetch(`/api/dolby-vision/resources/${encodeURIComponent(sourceIdentity)}/hls-graph`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(response.status === 404
          ? '该资源尚未建立完整的 HLS 资产图'
          : '可信 HLS 资产图暂不可用');
      }
      const data = payload as Record<string, unknown>;
      if (data.resourceId !== sourceIdentity || !Array.isArray(data.members) || !Array.isArray(data.edges)) {
        throw new Error('HLS 资产图响应与当前资源不匹配');
      }
      const edges = data.edges.filter((edge): edge is Record<string, unknown> =>
        Boolean(edge) && typeof edge === 'object' && !Array.isArray(edge));
      const rootAsset = data.rootAsset && typeof data.rootAsset === 'object' && !Array.isArray(data.rootAsset)
        ? data.rootAsset as Record<string, unknown>
        : null;
      const rootAssetId = typeof rootAsset?.assetId === 'string' ? rootAsset.assetId : '';
      const directVariants = edges
        .filter((edge) => edge.parentAssetId === rootAssetId && edge.role === 'playlist' &&
          typeof edge.childAssetId === 'string')
        .map((edge) => String(edge.childAssetId));
      const variantAssetIds = directVariants.length > 0 ? directVariants : rootAssetId ? [rootAssetId] : [];
      if (!controller.signal.aborted) {
        setHlsGraph({
          resourceId: sourceIdentity,
          memberCount: data.members.length,
          playlistCount: edges.filter((edge) => edge.role === 'playlist').length,
          initializationCount: edges.filter((edge) => edge.role === 'initialization').length,
          segmentCount: edges.filter((edge) => edge.role === 'segment').length,
          variantAssetIds,
        });
        setHlsGraphState('idle');
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setHlsGraphError(error instanceof Error ? error.message : 'HLS 资产图读取失败');
      setHlsGraphState('error');
    });
    return () => {
      controller.abort();
      hlsAnalysisRequestRef.current?.abort();
      hlsSegmentAnalysisRequestRef.current?.abort();
    };
  }, [sourceKind, sourceIdentity, report?.container]);

  async function analyzeHlsVariant(variantAssetId: string) {
    if (!sourceIdentity || !/^[a-z0-9_-]{1,80}$/i.test(sourceIdentity) ||
        !/^[A-Za-z0-9:_-]{1,200}$/.test(variantAssetId) ||
        hlsAnalysisState === 'loading' || hlsSegmentAnalysisState === 'loading') return;
    hlsAnalysisRequestRef.current?.abort();
    const controller = new AbortController();
    hlsAnalysisRequestRef.current = controller;
    setHlsAnalysisState('loading');
    setHlsAnalysisError('');
    setHlsEvidence(null);
    try {
      const response = await fetch(
        `/api/dolby-vision/resources/${encodeURIComponent(sourceIdentity)}/hls-analysis/${encodeURIComponent(variantAssetId)}`,
        { method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: controller.signal },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(response.status === 503
          ? '可信 HLS 分析服务尚未配置或当前不可用'
          : response.status === 409
            ? '该 HLS 变体不是受支持的清晰 fMP4 VOD 资产图'
            : 'HLS RPU 分析或签名证据验证失败');
      }
      const data = payload as Record<string, unknown>;
      const evidence = data.evidence && typeof data.evidence === 'object' && !Array.isArray(data.evidence)
        ? data.evidence as Record<string, unknown>
        : null;
      const graph = data.graph && typeof data.graph === 'object' && !Array.isArray(data.graph)
        ? data.graph as Record<string, unknown>
        : null;
      if (data.verified !== true || data.analysisScope !== 'hls-fmp4' ||
          data.resourceId !== sourceIdentity || data.variantAssetId !== variantAssetId ||
          typeof graph?.graphSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(graph.graphSha256) ||
          evidence?.source !== 'dovi_tool' || evidence.rpuPresent !== true ||
          !Number.isSafeInteger(evidence.frameCount) || !Array.isArray(evidence.metadataLevels) ||
          !evidence.metadataLevels.every((level) => Number.isSafeInteger(level))) {
        throw new Error('HLS 签名证据与当前资产图不匹配');
      }
      if (!controller.signal.aborted) {
        setHlsEvidence({
          resourceId: sourceIdentity,
          variantAssetId,
          profile: typeof evidence.profile === 'number' ? evidence.profile : null,
          frameCount: Number(evidence.frameCount),
          metadataLevels: evidence.metadataLevels as number[],
          graphSha256: graph.graphSha256,
        });
        setHlsAnalysisState('idle');
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setHlsAnalysisError(error instanceof Error ? error.message : 'HLS RPU 分析暂不可用');
      setHlsAnalysisState('error');
    }
  }

  async function analyzeHlsSegments(variantAssetId: string) {
    if (!sourceIdentity || !/^[a-z0-9_-]{1,80}$/i.test(sourceIdentity) ||
        !/^[A-Za-z0-9:_-]{1,200}$/.test(variantAssetId) ||
        hlsSegmentAnalysisState === 'loading' || hlsAnalysisState === 'loading') return;
    hlsSegmentAnalysisRequestRef.current?.abort();
    const controller = new AbortController();
    hlsSegmentAnalysisRequestRef.current = controller;
    setHlsSegmentAnalysisState('loading');
    setHlsSegmentAnalysisError('');
    setHlsSegmentEvidence(null);
    try {
      const response = await fetch(
        `/api/dolby-vision/resources/${encodeURIComponent(sourceIdentity)}/hls-analysis/${encodeURIComponent(variantAssetId)}/segments`,
        { method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: controller.signal },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(response.status === 503
          ? '分片级可信分析服务尚未配置或当前不可用'
          : response.status === 409
            ? 'HLS 分片图谱不完整或时间轴不连续'
            : '分片 RPU 分析或 Ed25519 签名验证失败');
      }
      const data = payload as Record<string, unknown>;
      const graph = data.graph && typeof data.graph === 'object' && !Array.isArray(data.graph)
        ? data.graph as Record<string, unknown>
        : null;
      if (data.verified !== true || data.analysisScope !== 'hls-fmp4-segment-set' ||
          data.resourceId !== sourceIdentity || data.variantAssetId !== variantAssetId ||
          !Number.isSafeInteger(data.segmentCount) || !Number.isSafeInteger(data.totalRpuFrameCount) ||
          data.timelineContinuity !== 'contiguous' ||
          data.rpuProfileContinuity !== 'consistent' ||
          data.rpuFrameAlignment !== 'one-rpu-per-video-sample' ||
          data.rpuSemanticContinuity !== 'not-established' ||
          typeof graph?.graphSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(graph.graphSha256) ||
          !Array.isArray(data.segments) || data.segments.length !== data.segmentCount ||
          !data.segments.every((segment) => Boolean(segment) && typeof segment === 'object' &&
            !Array.isArray(segment) && Number.isSafeInteger((segment as Record<string, unknown>).frameCount) &&
            Array.isArray((segment as Record<string, unknown>).metadataLevels) &&
            ((segment as Record<string, unknown>).metadataLevels as unknown[]).every((level) => Number.isSafeInteger(level)))) {
        throw new Error('分片签名证据与当前 HLS 资产图不匹配');
      }
      const segmentMetadataLevels = [...new Set(data.segments.flatMap((segment) =>
        (segment as { metadataLevels: number[] }).metadataLevels))].sort((left, right) => left - right);
      if (!controller.signal.aborted) {
        setHlsSegmentEvidence({
          resourceId: sourceIdentity,
          variantAssetId,
          segmentCount: Number(data.segmentCount),
          totalRpuFrameCount: Number(data.totalRpuFrameCount),
          rpuFrameAlignment: 'one-rpu-per-video-sample',
          metadataLevels: segmentMetadataLevels,
          graphSha256: graph.graphSha256,
        });
        setHlsSegmentAnalysisState('idle');
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setHlsSegmentAnalysisError(error instanceof Error ? error.message : '分片 RPU 分析暂不可用');
      setHlsSegmentAnalysisState('error');
    }
  }

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
              <span>{currentVerifiedEvidence || currentHlsEvidence || currentHlsSegmentEvidence ? '已验证存在' : '未验证'}</span>
            </div>
            {sourceKind === 'registry' && report?.container === 'hls' && (
              <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2">
                <div className="flex justify-between gap-3">
                  <span className="font-semibold text-white/80">可信 HLS 资产图</span>
                  <span>{hlsGraphState === 'loading' ? '读取中…' : hlsGraph ? '已读取' : '未验证'}</span>
                </div>
                {hlsGraph && hlsGraph.resourceId === sourceIdentity && (
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-white/65">
                    <span>资产成员：{hlsGraph.memberCount}</span>
                    <span>媒体分片：{hlsGraph.segmentCount}</span>
                    <span>初始化段：{hlsGraph.initializationCount}</span>
                    <span>嵌套清单：{hlsGraph.playlistCount}</span>
                  </div>
                )}
                {hlsGraph?.resourceId === sourceIdentity && (hlsGraph?.variantAssetIds.length ?? 0) > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {(hlsGraph?.variantAssetIds ?? []).map((variantId) => (
                      <div key={variantId} className="space-y-1.5">
                      <button
                        key={variantId}
                        type="button"
                        disabled={hlsAnalysisState === 'loading' || hlsSegmentAnalysisState === 'loading'}
                        onClick={() => void analyzeHlsVariant(variantId)}
                        className="w-full rounded-md bg-white/10 px-2.5 py-2 text-left text-[10px] font-medium text-white/90 transition hover:bg-white/20 disabled:cursor-wait disabled:opacity-60"
                      >
                        {hlsAnalysisState === 'loading' ? '正在分析 HLS fMP4 RPU…' :
                          currentHlsEvidence?.variantAssetId === variantId ? '重新验证此 HLS 变体 RPU' :
                            `分析此 HLS 变体 RPU · ${variantId}`}
                      </button>
                      <button
                        key={`${variantId}-segments`}
                        type="button"
                        disabled={hlsSegmentAnalysisState === 'loading' || hlsAnalysisState === 'loading'}
                        onClick={() => void analyzeHlsSegments(variantId)}
                        className="w-full rounded-md border border-amber-300/25 bg-amber-300/10 px-2.5 py-2 text-left text-[10px] font-medium text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-wait disabled:opacity-60"
                      >
                        {hlsSegmentAnalysisState === 'loading' ? '正在逐片解析并验签…' :
                          currentHlsSegmentEvidence?.variantAssetId === variantId
                            ? '重新验证全部分片 RPU'
                            : `逐片解析并验签 · ${variantId}`}
                      </button>
                      </div>
                    ))}
                  </div>
                )}
                {hlsAnalysisError && <p role="alert" className="mt-1 text-amber-200">{hlsAnalysisError}</p>}
                {hlsSegmentAnalysisError && <p role="alert" className="mt-1 text-amber-200">{hlsSegmentAnalysisError}</p>}
                {currentHlsSegmentEvidence && (
                  <div className="mt-2 rounded-md border border-amber-300/25 bg-amber-300/5 p-2 text-[10px] text-amber-100">
                    <p>已逐片完成 RPU 分析与 Ed25519 验签</p>
                    <p>已验分片：{currentHlsSegmentEvidence.segmentCount.toLocaleString()}</p>
                    <p>RPU 帧计数合计：{currentHlsSegmentEvidence.totalRpuFrameCount.toLocaleString()}</p>
                    <p>RPU 帧对齐：每个视频样本 1 帧 RPU</p>
                    <p>Dolby Vision Profile：跨分片一致</p>
                    <p>图谱 SHA-256：{currentHlsSegmentEvidence.graphSha256.slice(0, 16)}…</p>
                    <p className="mt-1 text-white/65">视频时间轴连续，RPU 与视频样本逐帧对齐；RPU 内容的跨片语义连续性仍未建立。</p>
                  </div>
                )}
                {currentHlsEvidence && (
                  <div className="mt-2 rounded-md border border-emerald-300/20 bg-emerald-300/5 p-2 text-[10px] text-emerald-100">
                    <p>已验证 HLS fMP4 RPU：Profile {currentHlsEvidence.profile ?? '多 Profile / 未唯一归属'}</p>
                    <p>解析帧数：{currentHlsEvidence.frameCount.toLocaleString()}</p>
                    <p>元数据层：{currentHlsEvidence.metadataLevels.join(' / ')}</p>
                    <p>图谱 SHA-256：{currentHlsEvidence.graphSha256.slice(0, 16)}…</p>
                    <p className="mt-1 text-amber-100">视频时间戳连续性已通过校验；跨分片 RPU 连续性尚未验证。</p>
                  </div>
                )}
                {hlsGraphError && <p role="alert" className="mt-1 text-amber-200">{hlsGraphError}</p>}
                <p className="mt-1 text-[10px] leading-snug text-white/45">
                  {currentHlsSegmentEvidence
                    ? '全部分片已分别完成 RPU 解析和签名验真；视频时间轴连续且每个视频样本均有对应 RPU。RPU 内容的跨片语义连续性仍需逐帧数据验证。'
                    : currentHlsEvidence
                      ? '已完成此变体的整段签名 RPU 分析；视频时间戳连续性已通过校验；分片级 RPU 尚未逐片验真。'
                      : '这里只核对不可变资产身份与分片关系；分片级 RPU 尚未分析。'}
                </p>
              </div>
            )}
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
                {currentVerifiedEvidence || currentHlsEvidence || currentHlsSegmentEvidence
                  ? (currentVerifiedEvidence?.evidence.metadataLevels ??
                    currentHlsEvidence?.metadataLevels ??
                    currentHlsSegmentEvidence?.metadataLevels ?? [])
                    .some((level) => level === 1 || level === 2)
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
              <span className="text-white/55">浏览器原生 HLS 能力</span>
              <span>{browserCapability?.nativeHls ?? 'unknown'}（能力查询）</span>
            </div>
            {browserCapability?.codecs.map((codec, index) => (
              <div key={`${codec.codec}-${index}`} className="flex justify-between gap-3">
                <span className="text-white/55">声明 Codec · {codec.codec}</span>
                <span>{codec.support}（非播放证明）</span>
              </div>
            ))}
            <div className="flex justify-between gap-3">
              <span className="text-white/55">显示 HDR 查询</span>
              <span>{browserCapability?.hdrDisplayHint ?? 'unknown'}（非输出证明）</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/55">系统原生解码状态</span>
              <span>实际解码未验证</span>
            </div>
            <p className="text-[10px] text-white/50">
              浏览器 canPlayType 和动态范围媒体查询只提供能力提示，不能读取已选择的 HLS 变体、硬件位流、实际 RPU 消费情况或 HDR 像素输出。
            </p>
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
                ? '当前检测到 AV1 Dolby Vision 声明；服务端会从已登记 MP4 解复用 AV1 OBU，提取 Dolby T.35/EMDF RPU，并将结果绑定原始媒体 SHA-256 后签名验证。当前仅支持单 AV1 视频轨 MP4；完整真实影片和设备端解码输出仍需独立验收。'
                : '当前 MP4 未能确认是单一 HEVC 视频编码；服务端 RPU 分析目前仅支持 MP4 + 单一 HEVC 视频轨道。'}
            </p>
          )}
          {assetId && report?.container !== 'mp4' && report?.container !== 'hls' && (
            <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-snug text-white/45">
              当前媒体已绑定不可变资产 ID；服务端 RPU 分析目前仅支持 MP4 + HEVC，WebM 的 RPU 分析保持未验证。
            </p>
          )}
          {sourceKind === 'registry' && report?.container === 'hls' && !currentHlsEvidence && (
            <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-snug text-white/45">
              当前 HLS 尚未取得已签名的变体 RPU 分析结果；只有清晰 VOD fMP4 变体可进入分析，MPEG-TS、加密及不连续流会失败关闭。
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
