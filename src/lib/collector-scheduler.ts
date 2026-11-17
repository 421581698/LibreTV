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
const emptyOutcome = (): IngestOutcome => ({ considered: 0, registered: 0, duplicates: 0, rejected: 0, sources: [] });

/** Uses the Collector's real /v1/discover endpoint; the Collector itself enforces its egress gate. */
export async function discoverCollectorSites(request?: Request) {
  return collectorRequest('/v1/discover', {}, 30_000, request);
}

/** Existing Collector contract is synchronous /v1/crawl, not a separate jobs/submit API. */
export async function startCollectorCrawl(input: CrawlInput) {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url || url.length > 2_048) {
    return NextResponse.json({ error: '采集网址无效。' }, { status: 400 });
  }
  const mode = input.mode ?? 'auto';
  const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(input.limit as number, 200)) : 50;
  const searchKeyword = typeof input.searchKeyword === 'string' ? input.searchKeyword.trim().slice(0, 100) : '';
  return collectorRequest('/v1/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, mode, limit, search_keyword: searchKeyword }),
  }, 120_000, input.request);
}

/** The Collector exposes a persisted task list, not a /v1/jobs/{id} endpoint. */
export async function getCollectorTaskStatus(taskId: string, request?: Request) {
  const id = safeTaskId(taskId);
  const response = await collectorRequest('/v1/tasks?limit=100', {}, 10_000, request);
  if (response.status !== 200) return response;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const tasks = payload && Array.isArray(payload.tasks) ? payload.tasks : [];
  const task = tasks.map(asRecord).find((item) => item?.id === id);
  if (!task) return NextResponse.json({ error: '未找到该 Collector 任务（仅返回最近 100 条）。' }, { status: 404 });
  return NextResponse.json({ task });
}

export async function getCollectorTaskCandidates(taskId: string, request?: Request) {
  return collectorRequest(`/v1/tasks/${safeTaskId(taskId)}/candidates`, {}, 15_000, request);
}

/** Validate each CMS candidate through the Collector's own gated validation endpoint. */
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
  if (task.status !== 'completed') {
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
  if (!record || record.status !== 'completed') return outcome;
  const result = asRecord(record.result) ?? {};
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
