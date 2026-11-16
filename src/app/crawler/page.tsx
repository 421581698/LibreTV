'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

type Candidate = {
  candidate_id: string;
  title: string;
  source_url: string;
  media_type: string | null;
  status: string;
  quality_json?: {
    quality_label?: string;
    max_height?: number | null;
    max_bitrate_bps?: number | null;
    hdr_claim?: boolean;
    verification_level?: string;
  } | null;
  updated_at: string;
};

type Workflow = {
  workflow_id: string;
  status: string;
  node_count: number;
  completed_count: number;
  failed_count: number;
  created_at: string;
};

type WorkflowDetail = {
  workflow_id: string;
  status: string;
  nodes: Array<{
    node_id: string;
    node_type: string;
    status: string;
    attempt_count: number;
    error?: string | null;
  }>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/crawler/${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || `请求失败（${response.status}）`);
  }
  return payload as T;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    queued: '排队中',
    pending: '等待执行',
    retry_wait: '等待重试',
    pending_review: '待人工审核',
    paused: '已暂停',
    cancelled: '已取消',
    cancelling: '正在取消',
  };
  return labels[status] || status;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default function CrawlerControlCenterPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [seedText, setSeedText] = useState('');
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [candidateData, workflowData] = await Promise.all([
        api<{ candidates: Candidate[] }>('candidates?limit=100'),
        api<{ workflows: Workflow[] }>('workflows?limit=50'),
      ]);
      setCandidates(candidateData.candidates);
      setWorkflows(workflowData.workflows);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取爬虫引擎状态');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeWorkflowId = activeWorkflow?.workflow_id;
  const activeWorkflowStatus = activeWorkflow?.status;

  useEffect(() => {
    if (
      !activeWorkflowId ||
      activeWorkflowStatus === 'completed' ||
      activeWorkflowStatus === 'failed'
    ) return;
    let disposed = false;
    const poll = async () => {
      try {
        const data = await api<{ workflow: WorkflowDetail }>(
          `workflows/${activeWorkflowId}`,
        );
        if (!disposed) setActiveWorkflow(data.workflow);
        if (data.workflow.status === 'completed' || data.workflow.status === 'failed') {
          void refresh();
        }
      } catch {
        // Keep the last durable snapshot visible while the service reconnects.
      }
    };
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeWorkflowId, activeWorkflowStatus, refresh]);

  async function startWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const urls = [...new Set(seedText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
    if (!urls.length) {
      setError('请至少填写一个公开网站 URL。');
      return;
    }
    if (urls.length > 20) {
      setError('单次工作流最多接受 20 个起始 URL。');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const workflowId = `crawl_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
      await api('workflows', {
        method: 'POST',
        body: JSON.stringify({
          workflow_id: workflowId,
          input: { initiated_from: 'crawler_control_center' },
          nodes: [
            {
              node_id: 'validate',
              node_type: 'validate_public_urls',
              input: { urls },
            },
            { node_id: 'crawl', node_type: 'crawl_seed_urls', input: {} },
            { node_id: 'candidates', node_type: 'register_candidates', input: {} },
            { node_id: 'media', node_type: 'analyze_media_candidates', input: {} },
          ],
          edges: [
            ['validate', 'crawl'],
            ['crawl', 'candidates'],
            ['candidates', 'media'],
          ],
        }),
      });
      setNotice('采集工作流已提交，独立 Worker 将自动领取任务。');
      setSeedText('');
      const detail = await api<{ workflow: WorkflowDetail }>(`workflows/${workflowId}`);
      setActiveWorkflow(detail.workflow);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工作流提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function reviewCandidate(candidateId: string, decision: 'approved' | 'rejected') {
    const action = decision === 'approved' ? '批准候选' : '拒绝候选';
    if (!window.confirm(`确定要${action}吗？此操作只记录审核结论，不会发布到正式资源库。`)) {
      return;
    }
    try {
      await api(`candidates/${candidateId}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setNotice(`${action}已记录；正式资源库未发生变化。`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${action}失败`);
    }
  }

  const runningCount = workflows.filter((item) => item.status === 'running').length;
  const pendingReviewCount = candidates.filter(
    (item) => item.status === 'pending_review',
  ).length;
  const analyzedCount = candidates.filter((item) => item.quality_json).length;

  return (
    <main className="min-h-screen bg-[#080b12] px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
              LibreTV · Resource Intelligence
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              智能爬虫控制中心
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              自主采集任务、媒体质量分析与候选资源管理。AI 负责发现和分析，正式资源入库仍由你亲自决定。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-slate-200 transition hover:border-cyan-300/50 hover:bg-white/5"
          >
            刷新数据
          </button>
        </header>

        {error && (
          <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { label: '运行中的工作流', value: runningCount, detail: '独立 Worker 实时执行' },
            { label: '待人工审核候选', value: pendingReviewCount, detail: '不会自动进入正式资源库' },
            { label: '已有质量报告', value: analyzedCount, detail: 'HLS / DASH 清单分析' },
          ].map((item) => (
            <article key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <p className="text-sm text-slate-400">{item.label}</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums">{item.value}</p>
              <p className="mt-2 text-xs text-slate-500">{item.detail}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <form
            onSubmit={startWorkflow}
            className="space-y-4 rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/[0.08] to-white/[0.025] p-5 sm:p-6"
          >
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-cyan-200">NEW DISCOVERY</p>
              <h2 className="mt-2 text-xl font-semibold">启动自主采集</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                输入公开网站起始地址。系统会验证地址、执行 Scrapling 抓取、提取媒体链接、建立候选并分析 HLS/DASH 清单。
              </p>
            </div>
            <label className="block text-sm text-slate-300" htmlFor="crawler-seeds">
              起始 URL（每行一个，最多 20 个）
            </label>
            <textarea
              id="crawler-seeds"
              value={seedText}
              onChange={(event) => setSeedText(event.target.value)}
              placeholder={'https://example.com\nhttps://another-public-site.example'}
              rows={6}
              className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
            />
            <button
              type="submit"
              disabled={submitting || loading}
              className="w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '正在提交工作流…' : '启动采集工作流'}
            </button>
            <p className="text-xs leading-5 text-slate-500">
              仅抓取公开 HTTP(S) 资源，遵守 robots.txt。当前版本不执行递归链接发现、不绕过登录或 DRM。
            </p>
          </form>

          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">TASK RUNTIME</p>
                <h2 className="mt-2 text-xl font-semibold">工作流运行状态</h2>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                {workflows.length} 条记录
              </span>
            </div>
            {activeWorkflow && (
              <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">当前工作流</span>
                  <span className="text-xs text-cyan-200">{statusLabel(activeWorkflow.status)}</span>
                </div>
                <p className="mt-2 break-all font-mono text-xs text-slate-400">
                  {activeWorkflow.workflow_id}
                </p>
                <div className="mt-3 space-y-2">
                  {activeWorkflow.nodes.map((node) => (
                    <div key={node.node_id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-slate-300">{node.node_id}</span>
                      <span className="text-slate-400">
                        {statusLabel(node.status)} · 尝试 {node.attempt_count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 divide-y divide-white/[0.07]">
              {loading ? (
                <p className="py-8 text-center text-sm text-slate-500">正在读取运行记录…</p>
              ) : workflows.length ? (
                workflows.slice(0, 8).map((workflow) => (
                  <button
                    key={workflow.workflow_id}
                    type="button"
                    onClick={async () => {
                      try {
                        const data = await api<{ workflow: WorkflowDetail }>(
                          `workflows/${workflow.workflow_id}`,
                        );
                        setActiveWorkflow(data.workflow);
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : '无法读取工作流');
                      }
                    }}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left transition hover:bg-white/[0.025]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs text-slate-300">
                        {workflow.workflow_id}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {workflow.completed_count}/{workflow.node_count} 节点完成 · {formatDate(workflow.created_at)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {statusLabel(workflow.status)}
                    </span>
                  </button>
                ))
              ) : (
                <p className="py-8 text-center text-sm text-slate-500">暂无工作流，提交起始 URL 后开始。</p>
              )}
            </div>
          </section>
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
          <div className="flex flex-col gap-2 border-b border-white/10 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-amber-200">CANDIDATE CENTER</p>
              <h2 className="mt-2 text-xl font-semibold">资源候选库</h2>
              <p className="mt-1 text-sm text-slate-400">
                已发现的媒体地址、来源证据与质量声明。所有候选默认等待人工审核。
              </p>
            </div>
            <span className="text-xs text-slate-500">只读视图 · 不会自动发布</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-black/20 text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">媒体 / 来源</th>
                  <th className="px-4 py-3 font-medium">类型</th>
                  <th className="px-4 py-3 font-medium">质量分析</th>
                  <th className="px-4 py-3 font-medium">审核状态</th>
                  <th className="px-5 py-3 font-medium">更新时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.07]">
                {candidates.map((candidate) => (
                  <tr key={candidate.candidate_id} className="align-top">
                    <td className="max-w-[340px] px-5 py-4">
                      <p className="font-medium text-slate-200">{candidate.title}</p>
                      <a
                        href={candidate.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block truncate font-mono text-xs text-cyan-300/80 hover:text-cyan-200"
                      >
                        {candidate.source_url}
                      </a>
                      <p className="mt-1 font-mono text-[10px] text-slate-600">
                        {candidate.candidate_id}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-xs uppercase text-slate-400">
                      {candidate.media_type || 'unknown'}
                    </td>
                    <td className="px-4 py-4">
                      {candidate.quality_json ? (
                        <>
                          <p className="font-medium text-slate-200">
                            {candidate.quality_json.quality_label || '待确认'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {candidate.quality_json.max_height
                              ? `${candidate.quality_json.max_height}p`
                              : '分辨率未知'}
                            {candidate.quality_json.hdr_claim ? ' · HDR 声明' : ''}
                          </p>
                          <p className="mt-1 text-[10px] text-amber-300/80">
                            {candidate.quality_json.verification_level === 'manifest_claim_only'
                              ? '清单声明，非码流实测'
                              : candidate.quality_json.verification_level || '未验证'}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">尚无报告</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col items-start gap-2">
                        <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2.5 py-1 text-xs text-amber-200">
                          {statusLabel(candidate.status)}
                        </span>
                        {candidate.status === 'pending_review' && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void reviewCandidate(candidate.candidate_id, 'approved')}
                              className="rounded-lg border border-emerald-300/30 px-2.5 py-1 text-xs text-emerald-200 hover:bg-emerald-300/10"
                            >
                              批准
                            </button>
                            <button
                              type="button"
                              onClick={() => void reviewCandidate(candidate.candidate_id, 'rejected')}
                              className="rounded-lg border border-rose-300/30 px-2.5 py-1 text-xs text-rose-200 hover:bg-rose-300/10"
                            >
                              拒绝
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500">
                      {formatDate(candidate.updated_at)}
                    </td>
                  </tr>
                ))}
                {!loading && candidates.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-500">
                      暂无候选媒体。运行采集工作流后，发现的媒体链接会出现在这里。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <footer className="border-t border-white/10 pt-5 text-xs leading-5 text-slate-600">
          LibreTV Resource Intelligence · PostgreSQL Task Runtime · Scrapling · Candidate Approval Gate
        </footer>
      </div>
    </main>
  );
}
