import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { collectorRequest } from './resource-collector-client';
import {
  registerValidatedCmsSource,
  type CollectorCmsCandidate,
  type CollectorCmsValidation,
  type CollectorSourceStore,
} from './resource-collector-workflow';

export interface CollectorTask {
  id: string;
  status: 'running' | 'completed' | 'partial' | 'failed' | 'interrupted' | string;
  url?: string;
  host?: string;
  error?: string | null;
  result_count?: number;
  result?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface CollectorSite {
  title: string;
  url: string;
  host: string;
  directory?: string;
}
export interface CrawlInput {
  url: string;
  mode?: 'auto' | 'http' | 'browser';
  limit?: number;
  searchKeyword?: string;
  request?: Request;
}
export interface IngestOutcome {
  considered: number;
  registered: number;
  duplicates: number;
  rejected: number;
  sources: Array<{ url: string; name: string }>;
}
const TASK_ID_RE = /^[a-f0-9]{32}$/i;
function safeTaskId(taskId: string): string {
  if (!TASK_ID_RE.test(taskId)) throw new Error('Invalid collector task id');
  return taskId;
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return asRecord(JSON.parse(value)) ?? {}; } catch { return {}; }
  }
  return asRecord(value) ?? {};
}
function normalizeJob(raw: Record<string, unknown>): Record<string, unknown> {
  const status = raw.status === 'succeeded' ? 'completed' : raw.status;
  return { ...raw, status, result: parseObject(raw.result) };
}
const emptyOutcome = (): IngestOutcome => ({ considered: 0, registered: 0, duplicates: 0, rejected: 0, sources: [] });

/** Site discovery is a bounded Collector operation; crawl execution itself is always queued. */
export async function discoverCollectorSites(request?: Request) {
  return collectorRequest('/v1/discover', {}, 30_000, request);
}

/** Submit a durable crawl job. The separate Scrapling Worker executes it outside the HTTP request. */
export async function startCollectorCrawl(input: CrawlInput) {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url || url.length > 2_048) {
    return NextResponse.json({ error: '采集网址无效。' }, { status: 400 });
  }
  const mode = input.mode ?? 'auto';
  const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(input.limit as number, 200)) : 50;
  const searchKeyword = typeof input.searchKeyword === 'string' ? input.searchKeyword.trim().slice(0, 100) : '';
  const idempotencyKey = `resource-studio:crawl:${randomUUID()}`;
  const response = await collectorRequest('/v1/tasks/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_type: 'crawl',
      payload: { url, mode, limit, search_keyword: searchKeyword },
      idempotency_key: idempotencyKey,
    }),
  }, 15_000, input.request);
  if (response.status < 200 || response.status >= 300) return response;
  const job = await response.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof job?.id === 'string' && TASK_ID_RE.test(job.id) ? job.id : '';
  if (!id) return NextResponse.json({ error: 'Collector 未返回有效的队列任务 ID。' }, { status: 502 });
  return NextResponse.json({ task_id: id, status: job?.status ?? 'queued', job }, { status: 202 });
}

/** Queue jobs are queried by their durable job ID, not by the legacy synchronous task list. */
export async function getCollectorTaskStatus(taskId: string, request?: Request) {
  const id = safeTaskId(taskId);
  const response = await collectorRequest(`/v1/jobs/${id}`, {}, 10_000, request);
  if (response.status !== 200) return response;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || payload.id !== id) return NextResponse.json({ error: 'Collector 返回了无效任务记录。' }, { status: 502 });
  return NextResponse.json({ task: normalizeJob(payload) });
}

/** Resolve the legacy crawl task ID from the completed durable job before reading candidates. */
export async function getCollectorTaskCandidates(jobId: string, request?: Request) {
  const statusResponse = await getCollectorTaskStatus(jobId, request);
  if (statusResponse.status !== 200) return statusResponse;
  const payload = await statusResponse.json().catch(() => null) as Record<string, unknown> | null;
  const job = asRecord(payload?.task);
  const result = asRecord(job?.result);
  const crawlTaskId = typeof result?.task_id === 'string' && TASK_ID_RE.test(result.task_id)
    ? result.task_id
    : '';
  if (!crawlTaskId) return NextResponse.json({ candidates: [] });
  return collectorRequest(`/v1/tasks/${crawlTaskId}/candidates`, {}, 15_000, request);
}

/** Validate CMS candidates with Collector's own public-access gate before local source registration. */
export async function receiveCollectorTaskResult(
  store: CollectorSourceStore,
  taskId: string,
  request?: Request,
): Promise<{ status: number; task: Record<string, unknown> | null; ingest: IngestOutcome }> {
  const statusResponse = await getCollectorTaskStatus(taskId, request);
  if (statusResponse.status !== 200) return { status: statusResponse.status, task: null, ingest: emptyOutcome() };
  const statusPayload = await statusResponse.json().catch(() => null) as Record<string, unknown> | null;
  const task = asRecord(statusPayload?.task);
  if (!task) return { status: 502, task: null, ingest: emptyOutcome() };
  if (task.status !== 'completed' && task.status !== 'partial') {
    return { status: 409, task, ingest: emptyOutcome() };
  }

  const candidatesResponse = await getCollectorTaskCandidates(taskId, request);
  if (candidatesResponse.status !== 200) return { status: candidatesResponse.status, task, ingest: emptyOutcome() };
  const candidatePayload = await candidatesResponse.json().catch(() => null) as Record<string, unknown> | null;
  const rawCandidates = Array.isArray(candidatePayload?.candidates) ? candidatePayload.candidates : [];
  const validated: Array<Record<string, unknown>> = [];

  for (const raw of rawCandidates.slice(0, 200)) {
    const candidate = asRecord(raw);
    if (!candidate || candidate.kind !== 'cms-api-candidate' ||
        typeof candidate.id !== 'string' || !TASK_ID_RE.test(candidate.id) ||
        typeof candidate.url !== 'string') continue;

    const validationResponse = await collectorRequest(
      `/v1/candidates/${candidate.id}/validate`,
      { method: 'POST' },
      25_000,
      request,
    );
    if (validationResponse.status !== 200) {
      return { status: validationResponse.status, task, ingest: emptyOutcome() };
    }
    const validationPayload = await validationResponse.json().catch(() => null) as Record<string, unknown> | null;
    const validation = asRecord(validationPayload?.validation);
    if (!validation) continue;
    validated.push({
      ...candidate,
      validation: {
        cms_shape: validation.cms_shape === true,
        reachable: validation.reachable === true,
        source_url: typeof validation.source_url === 'string' ? validation.source_url : undefined,
        access: asRecord(validation.access) ?? {},
        reason: typeof validation.reason === 'string' ? validation.reason : undefined,
      },
    });
  }

  return {
    status: 200,
    task,
    ingest: ingestJobResult(store, { status: 'completed', result: { candidates: validated } }),
  };
}

export function ingestJobResult(
  store: CollectorSourceStore,
  job: Pick<CollectorTask, 'status'> | Record<string, unknown>,
): IngestOutcome {
  const outcome = emptyOutcome();
  const record = asRecord(job);
  if (!record || (record.status !== 'completed' && record.status !== 'partial' && record.status !== 'succeeded')) return outcome;
  const result = parseObject(record.result);
  const rawCandidates = Array.isArray(result.candidates) ? result.candidates : [];
  for (const raw of rawCandidates.slice(0, 200)) {
    const item = asRecord(raw);
    if (!item || typeof item.url !== 'string' || typeof item.kind !== 'string') continue;
    const validationRaw = asRecord(item.validation) ?? {};
    const accessRaw = asRecord(validationRaw.access) ?? {};
    const validation: CollectorCmsValidation = {
      cms_shape: validationRaw.cms_shape === true,
      reachable: validationRaw.reachable === true,
      source_url: typeof validationRaw.source_url === 'string' ? validationRaw.source_url : undefined,
      access: { access_state: typeof accessRaw.access_state === 'string' ? accessRaw.access_state : undefined },
      reason: typeof validationRaw.reason === 'string' ? validationRaw.reason : undefined,
    };
    const candidate: CollectorCmsCandidate = {
      url: item.url,
      kind: item.kind,
      host: typeof item.host === 'string' ? item.host : safeHost(item.url),
      title: typeof item.title === 'string' ? item.title : undefined,
      id: typeof item.id === 'string' ? item.id : undefined,
    };
    outcome.considered += 1;
    const admitted = registerValidatedCmsSource(
      store,
      candidate,
      validation,
      'via Scrapling Collector',
    );
    if (admitted.registered && admitted.sourceUrl) {
      outcome.registered += 1;
      outcome.sources.push({ url: admitted.sourceUrl, name: candidate.title || candidate.host });
    } else if (admitted.duplicate) outcome.duplicates += 1;
    else outcome.rejected += 1;
  }
  return outcome;
}
function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}
export const collectorScheduler = {
  discoverCollectorSites,
  startCollectorCrawl,
  getCollectorTaskStatus,
  getCollectorTaskCandidates,
  receiveCollectorTaskResult,
  ingestJobResult,
};
