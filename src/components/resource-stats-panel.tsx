'use client';

import { useCallback, useEffect, useState } from 'react';
import { collectorFetch } from '@/lib/collector-browser-config';

type Quality = Record<string, number>;
type SiteStat = {
  host: string; title: string; directory: string; crawl_tasks: number;
  succeeded_tasks: number; failed_tasks: number; last_crawl_at: number | null;
  last_status: string; last_error: string | null; candidate_count: number;
  video_candidates: number; preflight_passed: number; playback_confirmed: number;
  actual_quality: Quality; pages_visited: number | null; pages_failed?: number;
  movie_entries?: number; episode_entries?: number; registry_resources?: number;
  pages_changed?: number; pages_unchanged?: number;
  health_status?: string; failure_streak?: number; playback_samples?: number; preview_samples?: number;
  quality_score?: number | null; quality_score_state?: string;
};
type StatsPayload = {
  source: string; generated_at: number;
  summary: {
    discovered_sites: number; visited_sites: number; successful_sites: number;
    failed_sites: number; crawl_tasks: number; candidate_resources: number;
    video_candidates: number; preflight_passed: number; playback_confirmed: number;
    actual_quality: Quality; movie_entries: number; episode_entries: number;
    playback_samples?: number; preview_samples?: number;
    pages_visited?: number; pages_failed?: number; pages_changed?: number; pages_unchanged?: number;
    queue_jobs?: Record<string, number>;
    quality_ranking?: Array<{ host: string; title: string; score: number; samples: number }>;
  };
  sites: SiteStat[]; site?: SiteStat | null;
  recent_jobs?: Array<{ id: string; job_type: string; status: string; attempt: number; max_attempts: number; error?: string | null; created_at: number; updated_at: number }>;
  recent_tasks?: Array<{ id: string; status: string; created_at: number; updated_at: number; error?: string | null; result_count: number }>;
  recent_resources?: Array<{ title: string; kind: string; status: string; access_state: string; playback_confirmed: boolean; decoded_width: number; decoded_height: number; created_at: number }>;
};
const QUALITY_ORDER = ['8K', '4K', '2K', '1080P', '720P', '480P', 'SD', '未知'];
const fmt = (v: number | null | undefined) => typeof v === 'number' ? v.toLocaleString() : '—';
const date = (v: number | null | undefined) => v ? new Date(v * 1000).toLocaleString() : '暂无记录';

export function ResourceStatsPanel() {
  const [data, setData] = useState<StatsPayload | null>(null);
  const [selectedHost, setSelectedHost] = useState('');
  const [detail, setDetail] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (host?: string) => {
    setLoading(true); setError('');
    try {
      const suffix = host ? '&host=' + encodeURIComponent(host) : '';
      const response = await collectorFetch('/api/resource-collector?action=stats' + suffix, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || '读取真实采集统计失败。');
      if (host) setDetail(payload as StatsPayload); else setData(payload as StatsPayload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取采集统计失败。');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const selectSite = (host: string) => { setSelectedHost(host); setDetail(null); void load(host); };
  const summary = data?.summary;

  return (
    <section className="rounded-2xl border border-line bg-card p-4 space-y-4" aria-label="网站采集统计中心">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-content">网站采集统计中心</h3>
          <p className="mt-1 text-xs text-muted">真实 Collector SQLite 数据；不使用模拟进度或 CI 测试数据。</p>
        </div>
        <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={() => void load()}>
          {loading ? '正在刷新…' : '刷新统计'}
        </button>
      </div>
      {error ? <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p> : null}
      {!data && !error ? <p className="text-xs text-muted">正在读取 Collector 数据…</p> : null}
      {summary ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['发现网站', summary.discovered_sites], ['已采集网站', summary.visited_sites],
              ['资源候选', summary.candidate_resources], ['视频候选', summary.video_candidates],
              ['媒体预检通过', summary.preflight_passed], ['采集预览确认资源', summary.playback_confirmed],
              ['真实播放样本', summary.playback_samples ?? 0], ['采集预览样本', summary.preview_samples ?? 0],
              ['电影条目', summary.movie_entries], ['剧集条目', summary.episode_entries],
              ['采集任务', summary.crawl_tasks], ['失败网站', summary.failed_sites],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-chip p-3">
                <div className="text-[11px] text-muted">{label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-content">{fmt(Number(value))}</div>
              </div>
            ))}
          </div>
          {summary.queue_jobs ? (
            <div className="rounded-xl border border-line p-3">
              <div className="mb-2 text-xs font-semibold text-content">持久任务队列</div>
              <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
                {['queued','running','succeeded','failed','cancelled','total'].map((key) => (
                  <div key={key} className="rounded-lg bg-chip p-2">
                    <span className="text-muted">{({queued:'排队',running:'运行中',succeeded:'成功',failed:'失败',cancelled:'取消',total:'总任务'} as Record<string,string>)[key]}</span>
                    <strong className="mt-1 block tabular-nums text-content">{fmt(summary.queue_jobs?.[key] ?? 0)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {data.recent_jobs?.length ? (
            <div className="rounded-xl border border-line p-3 space-y-2">
              <h4 className="text-xs font-semibold text-content">最近持久化任务</h4>
              {data.recent_jobs.slice(0, 8).map((job) => (
                <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-[11px]">
                  <span className="text-content">{job.job_type} · {job.status}</span>
                  <span className="text-muted">尝试 {job.attempt}/{job.max_attempts} · {date(job.created_at)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="rounded-xl border border-line p-3">
            <div className="mb-3 text-xs font-semibold text-content">实际播放解码清晰度</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {QUALITY_ORDER.map((q) => (
                <div key={q} className="flex items-center justify-between rounded-lg bg-chip px-3 py-2 text-xs">
                  <span className="text-muted">{q}</span>
                  <strong className="tabular-nums text-content">{fmt(summary.actual_quality?.[q] ?? 0)}</strong>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">仅按播放器实际解码宽高分类；网站宣传的 4K 不计入实际 4K。质量统计仅使用正常播放页的真实样本；采集预览样本单独统计，不参与真实播放质量评分。未记录原始视频 URL、片名或用户身份。</p>
          </div>
          {summary.quality_ranking?.length ? (
            <div className="rounded-xl border border-line p-3 space-y-2">
              <h4 className="text-xs font-semibold text-content">真实播放质量排行</h4>
              {summary.quality_ranking.slice(0, 5).map((entry, index) => (
                <div key={entry.host} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-content">{index + 1}. {entry.title || entry.host}</span>
                  <span className="shrink-0 tabular-nums text-muted">{entry.score}/100 · {entry.samples} 个播放样本</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-chip p-3 text-[11px] text-muted">质量排行暂不生成：每个网站至少需要 3 条真实播放样本及足够的播放时长。</p>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-content">逐网站采集档案</h4>
              <span className="text-[10px] text-muted">更新于 {date(data.generated_at)}</span>
            </div>
            {data.sites.length ? data.sites.map((site) => (
              <button key={site.host} type="button" onClick={() => selectSite(site.host)}
                className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3 text-left hover:bg-hover">
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-xs text-content">{site.title || site.host}</strong>
                  <span className="mt-1 block truncate text-[11px] text-muted">{site.host} · {site.directory}</span>
                  <span className="mt-1 block text-[10px] text-muted">健康状态：{({healthy:'正常',degraded:'需关注',failing:'连续失败',unknown:'暂无样本'} as Record<string,string>)[site.health_status || 'unknown']} · 质量评分：{site.quality_score == null ? '样本不足' : site.quality_score + '/100'}</span>
                </span>
                <span className="grid grid-cols-3 gap-3 text-right text-[11px]">
                  <span><b className="block tabular-nums text-content">{fmt(site.video_candidates)}</b><i className="not-italic text-muted">候选</i></span>
                  <span><b className="block tabular-nums text-content">{fmt(site.preflight_passed)}</b><i className="not-italic text-muted">预检</i></span>
                  <span><b className="block tabular-nums text-content">{fmt(site.playback_confirmed)}</b><i className="not-italic text-muted">预览确认</i></span>
                </span>
              </button>
            )) : <p className="rounded-xl bg-chip p-3 text-xs text-muted">暂无网站记录。请先刷新 FMHY 目录。</p>}
          </div>
          {selectedHost && detail?.site ? (
            <div className="space-y-3 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-content">{detail.site.title}</h4>
                  <p className="text-xs text-muted">{detail.site.host} · 最近采集：{date(detail.site.last_crawl_at)}</p>
                  <p className="text-xs text-muted">质量评分：{detail.site.quality_score == null ? '样本不足（至少 3 次播放）' : detail.site.quality_score + '/100'} · 健康状态：{detail.site.health_status}</p>
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setSelectedHost(''); setDetail(null); }}>关闭</button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {QUALITY_ORDER.map((q) => <div key={q} className="rounded-lg bg-chip p-2 text-xs"><span className="text-muted">{q}</span><strong className="float-right tabular-nums text-content">{fmt(detail.site?.actual_quality?.[q] ?? 0)}</strong></div>)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-chip p-2">页面访问：{fmt(detail.site.pages_visited ?? 0)}</div>
                <div className="rounded-lg bg-chip p-2">未完成访问：{fmt(detail.site.pages_failed ?? 0)}</div>
                <div className="rounded-lg bg-chip p-2">内容变化：{fmt(detail.site.pages_changed ?? 0)}</div>
                <div className="rounded-lg bg-chip p-2">内容未变：{fmt(detail.site.pages_unchanged ?? 0)}</div>
                <div className="rounded-lg bg-chip p-2">电影条目：{fmt(detail.site.movie_entries ?? 0)}</div>
                <div className="rounded-lg bg-chip p-2">剧集条目：{fmt(detail.site.episode_entries ?? 0)}</div>
                <div className="rounded-lg bg-chip p-2">采集任务：{fmt(detail.site.crawl_tasks)}</div>
                <div className="rounded-lg bg-chip p-2">预检通过：{fmt(detail.site.preflight_passed)}</div>
                <div className="rounded-lg bg-chip p-2">采集预览播放确认：{fmt(detail.site.playback_confirmed)}</div>
              </div>
              <p className="text-[10px] text-muted">电影与剧集数量来自 Registry 去重条目；动漫未建立独立可靠类型字段时不单独推算。未完成访问按已调度页面减去已处理页面计算，包含请求失败、拦截或中断等未处理页面，不代表每条都已确认 HTTP 错误。</p>
              {detail.recent_resources?.length ? (
                <div className="space-y-2">
                  <h5 className="text-xs font-semibold text-content">最近发现的资源</h5>
                  {detail.recent_resources.map((resource, index) => (
                    <div key={resource.title + '-' + index} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-chip p-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-content">{resource.title}</span>
                      <span className="text-muted">{resource.playback_confirmed && resource.decoded_height ? resource.decoded_width + '×' + resource.decoded_height : resource.status}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted">该网站暂无资源记录。</p>}
              {detail.recent_tasks?.length ? (
                <div className="space-y-1">
                  <h5 className="text-xs font-semibold text-content">最近采集任务</h5>
                  {detail.recent_tasks.map((task) => (
                    <div key={task.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2 text-[11px]">
                      <span className="text-content">{task.status} · {date(task.created_at)}</span>
                      <span className="text-muted">{task.error || fmt(task.result_count) + ' 个候选'}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="text-[10px] leading-5 text-muted">页面访问按 Spider 已处理页面与浏览器采集入口页的真实访问次数统计；不同采集引擎访问同一 URL 时分别计次。内容指纹用于识别未变化页面并跳过重复提取。</p>
        </>
      ) : null}
    </section>
  );
}
