import { NextResponse } from 'next/server';
import { collectorRequest } from './resource-collector-client';
import {
  registerValidatedCmsSource,
  type CollectorCmsCandidate,
  type CollectorCmsValidation,
  type CollectorSourceStore,
} from './resource-collector-workflow';

export interface CollectorJob {
  id: string;
  job_type: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | string;
  attempt?: number;
  result?: Record<string, unknown> | null;
  error?: string | null;
  events?: CollectorJobEvent[];
  [key: string]: unknown;
}
export interface CollectorJobEvent { event: string; detail?: unknown; created_at?: number; }
export interface SubmitDiscoverInput { searchKeyword?: string; idempotencyKey?: string; request?: Request; }
export interface IngestOutcome {
  considered: number; registered: number; duplicates: number; rejected: number;
  sources: Array<{ url: string; name: string }>;
}
const JOB_ID_RE = /^[a-f0-9]{32}$/i;
function safeJobId(jobId: string): string {
  if (!JOB_ID_RE.test(jobId)) throw new Error('Invalid collector job id');
  return jobId;
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export async function submitDiscoverJob(input: SubmitDiscoverInput = {}) {
  const keyword = typeof input.searchKeyword === 'string' ? input.searchKeyword.trim().slice(0, 50) : '';
  const idempotencyKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey.length <= 200
    ? input.idempotencyKey : 'resource-studio:discover:' + (keyword || 'all');
  return collectorRequest('/v1/tasks/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_type: 'discover', payload: keyword ? { search_keyword: keyword } : {},
      idempotency_key: idempotencyKey,
    }),
  }, 10_000, input.request);
}
export async function getJobStatus(jobId: string, request?: Request) {
  return collectorRequest(`/v1/jobs/${safeJobId(jobId)}`, {}, 10_000, request);
}
export async function getJobEvents(jobId: string, request?: Request) {
  const response = await getJobStatus(jobId, request);
  if (response.status !== 200) return response;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ code: 'COLLECTOR_INVALID_RESPONSE', error: 'Invalid job payload.' }, { status: 502 });
  const rawEvents = Array.isArray(payload.events) ? payload.events : [];
  const events = rawEvents.slice(0, 500).map((item) => {
    const event = asRecord(item) ?? {};
    return {
      event: typeof event.event === 'string' ? event.event.slice(0, 120) : '',
      detail: event.detail ?? null,
      created_at: typeof event.created_at === 'number' ? event.created_at : null,
    };
  });
  return NextResponse.json({ job_id: jobId, status: payload.status ?? null, events });
}
export function ingestJobResult(
  store: CollectorSourceStore,
  job: Pick<CollectorJob, 'status' | 'result' | 'events'> | Record<string, unknown>,
): IngestOutcome {
  const outcome: IngestOutcome = { considered: 0, registered: 0, duplicates: 0, rejected: 0, sources: [] };
  const record = asRecord(job);
  if (!record) return outcome;
  const status = typeof record.status === 'string' ? record.status : '';
  if (status !== 'succeeded' && status !== 'completed' && status !== 'done') return outcome;
  const result = asRecord(record.result) ?? {};
  const rawCandidates = Array.isArray(result.candidates) ? result.candidates
    : (Array.isArray(record.candidates) ? record.candidates : []);
  for (const raw of rawCandidates.slice(0, 200)) {
    const item = asRecord(raw);
    if (!item) continue;
    const url = typeof item.url === 'string' ? item.url : '';
    const kind = typeof item.kind === 'string' ? item.kind : '';
    if (!url || !kind) continue;
    const validationRaw = asRecord(item.validation) ?? {};
    const accessRaw = asRecord(validationRaw.access) ?? asRecord(item.access) ?? {};
    const validation: CollectorCmsValidation = {
      cms_shape: validationRaw.cms_shape === true || (typeof item.cms_shape === 'boolean' ? item.cms_shape : undefined),
      reachable: validationRaw.reachable === true || (typeof item.reachable === 'boolean' ? item.reachable : undefined),
      source_url: typeof validationRaw.source_url === 'string' ? validationRaw.source_url
        : (typeof item.source_url === 'string' ? item.source_url : undefined),
      access: { access_state: typeof accessRaw.access_state === 'string' ? accessRaw.access_state : undefined },
      reason: typeof validationRaw.reason === 'string' ? validationRaw.reason : undefined,
    };
    const candidate: CollectorCmsCandidate = {
      url, kind, host: typeof item.host === 'string' ? item.host : safeHost(url),
      title: typeof item.title === 'string' ? item.title : undefined,
      id: typeof item.id === 'string' ? item.id : undefined,
    };
    const detail = typeof item.detail === 'string' ? item.detail : 'via Scrapling Collector';
    outcome.considered += 1;
    const admitted = registerValidatedCmsSource(store, candidate, validation, detail);
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
export async function receiveJobResult(
  store: CollectorSourceStore, jobId: string, request?: Request,
): Promise<{ status: number; job: Record<string, unknown> | null; ingest: IngestOutcome }> {
  const response = await getJobStatus(jobId, request);
  if (response.status !== 200) return {
    status: response.status, job: null,
    ingest: { considered: 0, registered: 0, duplicates: 0, rejected: 0, sources: [] },
  };
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return {
    status: 502, job: null,
    ingest: { considered: 0, registered: 0, duplicates: 0, rejected: 0, sources: [] },
  };
  return { status: 200, job: payload, ingest: ingestJobResult(store, payload) };
}
export const collectorScheduler = { submitDiscoverJob, getJobStatus, getJobEvents, ingestJobResult, receiveJobResult };
