'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { collectorFetch } from '@/lib/collector-browser-config';
import { readLocalMediaLibrary, replaceLocalMediaLibrary } from '@/lib/local-media-library';

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
    media_type_counts?: Record<string, number>; identified_titles?: number; unclassified_candidates?: number;
    playback_samples?: number; preview_samples?: number;
    pages_visited?: number; pages_failed?: number; pages_changed?: number; pages_unchanged?: number;
    queue_jobs?: Record<string, number>;
    quality_ranking?: Array<{ host: string; title: string; score: number; samples: number }>;
  };
  sites: SiteStat[]; site?: SiteStat | null;
  recent_jobs?: Array<{ id: string; job_type: string; status: string; attempt: number; max_attempts: number; error?: string | null; created_at: number; updated_at: number; batch_target?: { minimum: number; target: number; collected: number; met: boolean; shortfall: number } | null; sites_scanned?: number | null; preflight?: { checked?: number; validated?: number; rejected?: number } | null }>;
  recent_tasks?: Array<{ id: string; status: string; created_at: number; updated_at: number; error?: string | null; result_count: number }>;
  recent_resources?: Array<{ title: string; media_type?: string; year?: number | null; season?: number | null; episode?: number | null; identity_confidence?: string; kind: string; status: string; access_state: string; playback_confirmed: boolean; decoded_width: number; decoded_height: number; actual_quality?: string; declared_quality?: string | null; poster?: string | null; created_at: number }>;
};
type LibraryResource = {
  id: string; url: string; title: string; movie_title?: string | null; episode_title?: string | null;
  release_year?: number | null; season?: number | null; episode?: number | null;
  resource_type: string; media_format?: string | null; playback_state: string;
  playback_evidence?: string | null; metadata?: string | null;
  validation_state?: string; access_state?: string; source_name?: string | null; source_host?: string | null;
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
  const [library, setLibrary] = useState<LibraryResource[]>([]);
  const [libraryError, setLibraryError] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryType, setLibraryType] = useState('all');
  const [libraryQuality, setLibraryQuality] = useState('all');

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

  const loadLibrary = useCallback(async () => {
    setLibraryError('');
    let cached: LibraryResource[] = [];
    try {
      cached = await readLocalMediaLibrary<LibraryResource>();
      if (cached.length) setLibrary(cached);
    } catch { /* Continue with the live registry when browser storage is unavailable. */ }
    try {
      const all: LibraryResource[] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;
      while (offset < total && offset < 100_000) {
        const response = await collectorFetch('/api/resource-collector?action=library&verifiedOnly=false&limit=100&offset=' + offset, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || '读取影视资源库失败。');
        const page = Array.isArray(payload.resources) ? payload.resources as LibraryResource[] : [];
        all.push(...page);
        total = Number.isFinite(Number(payload.total)) ? Number(payload.total) : offset + page.length;
        offset += page.length;
        if (!page.length || page.length < 100) break;
      }
      if (all.length || total === 0) {
        await replaceLocalMediaLibrary(all).catch(() => undefined);
        setLibrary(all);
      } else if (cached.length) {
        setLibrary(cached);
      }
    } catch (reason) {
      if (cached.length) {
        setLibraryError('采集服务暂不可用，正在使用本设备已保存的 ' + cached.length + ' 条影视资源。');
      } else {
        setLibraryError(reason instanceof Error ? reason.message : '读取影视资源库失败。');
      }
    }
  }, []);

  const startBatch = useCallback(async () => {
    setBatchSubmitting(true);
    setBatchMessage('');
    try {
      const response = await collectorFetch('/api/resource-collector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || '批量采集任务提交失败。');
      setBatchMessage('已提交跨站点采集任务：' + String(payload.job_id || '已排队') + '。目标至少 101 条唯一视频候选，最多尝试 25 个 FMHY 站点。');
    } catch (reason) {
      setBatchMessage(reason instanceof Error ? reason.message : '批量采集任务提交失败。');
    } finally {
      setBatchSubmitting(false);
    }
  }, []);
  useEffect(() => { void load(); void loadLibrary(); }, [load, loadLibrary]);
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
              ['影视条目', summary.movie_entries], ['剧集条目', summary.episode_entries],
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
                  <span className="text-content">{job.job_type} · {job.status}{job.batch_target ? ' · 视频候选 ' + job.batch_target.collected + '/' + job.batch_target.minimum + '（最低目标）' + (job.batch_target.met ? ' · 达标' : ' · 未达标') : ''}</span>
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
          <div className="rounded-xl border border-line p-3 space-y-2">
            <h4 className="text-xs font-semibold text-content">采集内容分类（含待识别候选）</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['电影', 'movie'], ['电视剧', 'tv'], ['动漫', 'anime'], ['纪录片', 'documentary'], ['综艺', 'variety'], ['短片', 'short'], ['待识别', 'unknown']].map(([label, key]) => (
                <div key={key} className="flex items-center justify-between rounded-lg bg-chip px-3 py-2 text-xs">
                  <span className="text-muted">{label}</span>
                  <strong className="tabular-nums text-content">{fmt(data.summary.media_type_counts?.[key] ?? 0)}</strong>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted">已识别片名 {fmt(data.summary.identified_titles ?? 0)} 条；只有结构化元数据或 Open Graph 明确提供的身份信息才进入已识别统计。</p>
          </div>
          <div className="rounded-xl border border-line p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-content">本地影视库 · 已保存资源</h4>
              <button type="button" className="btn-primary btn-sm" disabled={batchSubmitting} onClick={() => void startBatch()}>
                {batchSubmitting ? '正在提交…' : '启动 101+ 跨站点批量采集'}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => void loadLibrary()}>刷新</button>
            </div>
            {libraryError ? <p role="alert" className="text-xs text-red-600">{libraryError}</p> : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input aria-label="搜索本地影视库" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="搜索片名、年份、资源站…" className="min-w-0 rounded-lg border border-line bg-main px-3 py-2 text-xs text-content" />
              <select aria-label="影视类型" value={libraryType} onChange={(event) => setLibraryType(event.target.value)} className="rounded-lg border border-line bg-main px-3 py-2 text-xs text-content">
                <option value="all">全部类型</option><option value="movie">电影</option><option value="tv">电视剧</option><option value="anime">动漫</option><option value="documentary">纪录片</option><option value="variety">综艺</option><option value="short">短片</option><option value="unknown">待识别</option>
              </select>
              <select aria-label="画质筛选" value={libraryQuality} onChange={(event) => setLibraryQuality(event.target.value)} className="rounded-lg border border-line bg-main px-3 py-2 text-xs text-content">
                <option value="all">全部画质</option><option value="4K">4K</option><option value="1080P">1080P</option><option value="720P">720P</option><option value="unknown">画质未知</option>
              </select>
            </div>
            <p className="text-[10px] text-muted">本设备 IndexedDB 缓存 {library.length} 条；采集服务关闭后仍可搜索已同步资料。只有公开验证且播放器确认的资源可以播放。</p>

            {batchMessage ? <p role="status" className="text-xs text-muted">{batchMessage}</p> : null}
            {library.filter((resource) => {
              let metadata: any = {}; let identity: any = {}; let evidence: any = {};
              try { metadata = JSON.parse(resource.metadata || '{}'); identity = metadata.media_identity || {}; evidence = JSON.parse(resource.playback_evidence || '{}'); } catch { /* Keep unknown metadata searchable. */ }
              const title = resource.movie_title || resource.episode_title || identity.title_hint || resource.title || '';
              const type = identity.media_type || 'unknown';
              const quality = evidence.decoded_height >= 2160 ? '4K' : evidence.decoded_height >= 1080 ? '1080P' : evidence.decoded_height >= 720 ? '720P' : (metadata.quality_evidence?.declared_quality_label || identity.quality_hint || 'unknown');
              const haystack = [title, resource.release_year, resource.source_name, resource.source_host, resource.url].join(' ').toLowerCase();
              return (!libraryQuery.trim() || haystack.includes(libraryQuery.trim().toLowerCase())) &&
                (libraryType === 'all' || type === libraryType) &&
                (libraryQuality === 'all' || (libraryQuality === 'unknown' ? quality === 'unknown' : quality === libraryQuality));
            }).map((resource) => {
              let playHref = '';
              let mediaType = '待识别';
              let actualQuality = '画质未知';
              let identity: any = {}; let metadata: any = {}; let evidence: any = {};
              try {
                const mediaUrl = new URL(resource.url);
                metadata = JSON.parse(resource.metadata || '{}');
                identity = metadata.media_identity || {};
                evidence = JSON.parse(resource.playback_evidence || '{}');
                const labels: Record<string, string> = { movie: '电影', tv: '电视剧', anime: '动漫', documentary: '纪录片', variety: '综艺', short: '短片' };
                mediaType = labels[identity.media_type || ''] || '待识别';
                if (evidence.decoded_width && evidence.decoded_height) {
                  actualQuality = evidence.decoded_height >= 2160 ? '4K 实际解码' : evidence.decoded_height >= 1080 ? '1080P 实际解码' : evidence.decoded_height >= 720 ? '720P 实际解码' : evidence.decoded_width + '×' + evidence.decoded_height + ' 实际解码';
                } else {
                  const declared = metadata.quality_evidence?.declared_quality_label || identity.quality_hint;
                  if (declared) actualQuality = declared + ' 标称（未测解码）';
                }
                const canPlay = resource.resource_type === 'DIRECT_MEDIA' && resource.validation_state === 'validated' && resource.access_state === 'PUBLIC' && resource.playback_state === 'PLAYER_CONFIRMED';
                if (canPlay && mediaUrl.protocol === 'https:') {
                  const params = new URLSearchParams({ source: 'friday-cms', sourceUrl: mediaUrl.origin, url: resource.url, title: resource.movie_title || identity.title_hint || resource.title || '未知视频' });
                  playHref = '/watch?' + params.toString();
                }
              } catch { playHref = ''; }
              const title = resource.movie_title || resource.episode_title || identity.title_hint || resource.title || '待识别资源';
              const state = resource.playback_state === 'PLAYER_CONFIRMED' ? '已确认播放' : resource.validation_state === 'validated' && resource.access_state === 'PUBLIC' ? '公开资源 · 待播放器确认' : resource.access_state || '待验证';
              return (
                <div key={resource.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-chip p-3">
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-xs text-content">{title}</strong>
                    <span className="mt-1 block text-[11px] text-muted">{mediaType}{resource.release_year ? ' · ' + resource.release_year : ''}{resource.season != null && resource.episode != null ? ' · S' + resource.season + 'E' + resource.episode : ''}{' · '}{resource.source_host || resource.source_name || '来源未知'}{' · '}{resource.media_format === 'hls' ? 'HLS' : resource.media_format || '媒体流'}{' · '}{actualQuality}</span>
                    <span className="mt-1 block text-[10px] text-muted">{state}</span>
                  </div>
                  {playHref ? <Link href={playHref} className="btn-primary btn-sm shrink-0">本地播放</Link> : <span className="text-[11px] text-muted">已保存 · 暂不可播放</span>}
                </div>
              );
            }) : <p className="text-xs text-muted">{libraryError ? '正在显示本设备缓存（如有）。' : '本地影视库暂无匹配资源。'}</p>}
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
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-content">{resource.title}</strong>
                        <span className="text-[10px] text-muted">
                          {({movie:'电影',tv:'电视剧',anime:'动漫',documentary:'纪录片',variety:'综艺',short:'短片',unknown:'待识别'} as Record<string,string>)[resource.media_type || 'unknown']}
                          {resource.year ? ' · ' + resource.year : ''}
                          {resource.season != null && resource.episode != null ? ' · S' + resource.season + 'E' + resource.episode : ''}
                        </span>
                      </span>
                      <span className="text-muted">{resource.playback_confirmed && resource.decoded_height ? (resource.actual_quality || resource.decoded_width + '×' + resource.decoded_height) + ' · 已播放' : (resource.declared_quality ? resource.declared_quality + ' 标称 · ' + resource.status : resource.status)}</span>
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
