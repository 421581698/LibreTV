'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { collectorFetch } from '@/lib/collector-browser-config';

type Resource = {
  id: string;
  title: string;
  url: string;
  resource_type: string;
  media_format?: string | null;
  access_state: string;
  validation_state: string;
  playback_state: string;
  updated_at: number;
  source_name?: string;
  source_host?: string;
};
type Job = {
  id: string;
  job_type: string;
  status: string;
  attempt: number;
  created_at: number;
  error?: string | null;
};

const formatTime = (value?: number) => value ? new Date(value * 1000).toLocaleString() : '—';
const statusLabel: Record<string, string> = {
  queued: '排队中', running: '运行中', succeeded: '已完成', partial: '部分完成',
  failed: '失败', cancelled: '已取消', cancel_requested: '正在取消',
};

export default function ResourceStudioPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [agentGoal, setAgentGoal] = useState('同步 SeedHub 电影、电视剧和动漫目录，并发现可公开访问的资源站');
  const [agentConfigured, setAgentConfigured] = useState(false);
  const [agentProvider, setAgentProvider] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [resourceResponse, jobResponse] = await Promise.all([
        collectorFetch('/api/resource-collector?action=resources&limit=100'),
        collectorFetch('/api/resource-collector?action=jobs&limit=30'),
      ]);
      const resourcePayload = await resourceResponse.json();
      const jobPayload = await jobResponse.json();
      const agentPayload = await agentResponse.json().catch(() => ({}));
      if (!resourceResponse.ok) throw new Error(resourcePayload.error || '读取已验证资源失败');
      if (!jobResponse.ok) throw new Error(jobPayload.error || '读取采集任务失败');
      setResources(Array.isArray(resourcePayload.resources) ? resourcePayload.resources : []);
      setJobs(Array.isArray(jobPayload.jobs) ? jobPayload.jobs : []);
      setAgentConfigured(agentPayload.configured === true);
      setAgentProvider(typeof agentPayload.provider === 'string' ? agentPayload.provider : '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资源中心暂时不可用');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runAction = async (key: string, action: () => Promise<Response>, success: string) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const response = await action();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.detail || '操作失败');
      setNotice(success);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setBusy('');
    }
  };

  const discover = () => runAction('discover',
    () => collectorFetch('/api/resource-collector', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discover: true }) }),
    '已提交资源站发现任务。任务由后台 Worker 执行；出口防火墙未确认时会安全失败。');
  const runAgentSupervisor = () => runAction('agent',
    () => collectorFetch('/api/resource-collector/agent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: agentGoal }),
    }), 'AI Supervisor 已完成规划并提交任务。请在下方任务列表查看实际执行状态。');

  const syncSeedHub = (category: 'movies' | 'series' | 'anime') => runAction(category,
    () => collectorFetch('/api/resource-collector', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedhubSync: true, category, startPage: 1, pages: 20 }),
    }), 'SeedHub 目录同步任务已提交。');

  const jobAction = (job: Job, action: 'retry' | 'cancel') => runAction(job.id + ':' + action,
    () => collectorFetch('/api/resource-collector', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobAction: action, jobId: job.id }),
    }), action === 'retry' ? '任务已重新排队。' : '已请求取消任务。');

  const verifiedCount = resources.filter((item) => item.playback_state === 'PLAYER_CONFIRMED').length;
  const runningCount = jobs.filter((job) => job.status === 'running' || job.status === 'queued').length;

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 pb-16 pt-8 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.24em] text-[var(--accent)]">LIBRETV / RESOURCE INTELLIGENCE</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">独立资源管理中心</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">资源站发现、目录采集、任务监控与已验证资源出口。LibreTV 只读取通过公开访问检查和播放器验收的资源。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm">返回 LibreTV</Link>
            <button onClick={() => void refresh()} disabled={loading} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50">刷新数据</button>
          </div>
        </header>

        {error ? <div role="alert" className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">{error}</div> : null}
        {notice ? <div role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700">{notice}</div> : null}

        <section className="mb-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"><p className="text-sm text-[var(--muted)]">已通过播放器验收</p><p className="mt-2 text-3xl font-semibold">{loading ? '…' : verifiedCount}</p><p className="mt-1 text-xs text-[var(--muted)]">当前出口仅展示已确认资源</p></div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"><p className="text-sm text-[var(--muted)]">可用资源记录</p><p className="mt-2 text-3xl font-semibold">{loading ? '…' : resources.length}</p><p className="mt-1 text-xs text-[var(--muted)]">来自独立 Collector 注册表</p></div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"><p className="text-sm text-[var(--muted)]">待处理任务</p><p className="mt-2 text-3xl font-semibold">{loading ? '…' : runningCount}</p><p className="mt-1 text-xs text-[var(--muted)]">排队中与运行中的任务</p></div>
        </section>

        <section className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">AI 资源 Supervisor</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">由模型生成受限采集计划，再交给持久化 Worker 执行；AI 不能自行宣布资源可播放。</p>
            </div>
            <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">{agentConfigured ? '模型已配置 · ' + agentProvider : '模型未配置'}</span>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input value={agentGoal} onChange={(event) => setAgentGoal(event.target.value.slice(0, 200))} maxLength={200}
              aria-label="AI 采集目标" placeholder="告诉 AI 需要发现或同步什么公开资源"
              className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-transparent px-3 py-3 text-sm" />
            <button type="button" onClick={() => void runAgentSupervisor()} disabled={!agentConfigured || Boolean(busy) || agentGoal.trim().length < 3}
              className="rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {busy === 'agent' ? 'AI 正在规划…' : '让 AI 规划并提交任务'}
            </button>
          </div>
          {!agentConfigured ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">需要在 Preview Worker 配置 RESOURCE_AGENT_API_KEY，或配置专用 OpenClaw Agent：OPENCLAW_AGENT_RESOURCE_SUPERVISOR、Gateway Token/URL 与 Cloudflare Access 服务令牌。密钥只保存在服务器环境中。</p> : null}
        </section>

        <section className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">资源站发现与目录采集</h2><p className="mt-1 text-sm text-[var(--muted)]">任务会进入现有持久化队列；服务未配置或安全出口未启用时，操作会明确失败，不会伪装成已启动。</p></div>
            <button onClick={() => void discover()} disabled={Boolean(busy)} className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === 'discover' ? '正在提交…' : '发现公开资源站'}</button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {(['movies', 'series', 'anime'] as const).map((category) => <button key={category} onClick={() => void syncSeedHub(category)} disabled={Boolean(busy)} className="rounded-xl border border-[var(--border)] px-4 py-3 text-left text-sm disabled:opacity-50"><span className="block font-semibold">{category === 'movies' ? '采集电影目录' : category === 'series' ? '采集电视剧目录' : '采集动漫目录'}</span><span className="mt-1 block text-xs text-[var(--muted)]">SeedHub · 最多 20 页/批次</span></button>)}
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">已验证资源 · LibreTV 出口</h2><p className="mt-1 text-sm text-[var(--muted)]">只列出 PUBLIC + validated + PLAYER_CONFIRMED 的直接媒体资源。</p></div><span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700">严格筛选</span></div>
          {loading ? <p className="py-8 text-center text-sm text-[var(--muted)]">正在读取资源…</p> : resources.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">目前没有通过真实播放器验收的资源。目录资料或 HTTP 可访问不等于可播放。</div> : <div className="divide-y divide-[var(--border)]">{resources.map((item) => <article key={item.id} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><h3 className="truncate font-medium">{item.title}</h3><p className="mt-1 truncate text-xs text-[var(--muted)]">{item.source_name || item.source_host || '未知来源'} · {(item.media_format || '未知格式').toUpperCase()} · 更新于 {formatTime(item.updated_at)}</p><a href={item.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-[var(--accent)] underline">{item.url}</a></div><span className="w-fit rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700">播放器已确认</span></article>)}</div>}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold">采集任务</h2><p className="mt-1 text-sm text-[var(--muted)]">持久化队列状态与最近执行记录。</p></div><span className="text-xs text-[var(--muted)]">{jobs.length} 条</span></div>
          {jobs.length === 0 ? <p className="py-6 text-center text-sm text-[var(--muted)]">暂无任务记录</p> : <div className="divide-y divide-[var(--border)]">{jobs.map((job) => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-medium">{job.job_type} <span className="ml-2 font-mono text-xs text-[var(--muted)]">{job.id.slice(0, 10)}</span></p><p className="mt-1 text-xs text-[var(--muted)]">{formatTime(job.created_at)} · 尝试 {job.attempt} 次</p>{job.error ? <p className="mt-1 text-xs text-red-600">{job.error}</p> : null}</div><div className="flex items-center gap-2"><span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">{statusLabel[job.status] || job.status}</span>{['failed','partial'].includes(job.status) ? <button type="button" disabled={Boolean(busy)} onClick={() => void jobAction(job,'retry')} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">重试</button> : null}{['queued','running','cancel_requested'].includes(job.status) ? <button type="button" disabled={Boolean(busy)} onClick={() => void jobAction(job,'cancel')} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">取消</button> : null}</div></div>)}</div>}
        </section>

        <p className="mt-6 text-xs leading-6 text-[var(--muted)]">说明：这是资源管理网页与现有 Scrapling Collector 的第一阶段连接，不代表完整 AI Agent Runtime 已上线。AI 自主研究、Connector 自动生成/修复、DAG 调度和独立 PlayerShell 回归仍需后续实现。不会绕过登录、付费墙、DRM、验证码或其他访问限制，也不会自动启用未通过验收的片源。</p>
      </div>
    </main>
  );
}
