import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import {
  getJobEvents,
  getJobStatus,
  receiveJobResult,
  submitDiscoverJob,
} from '@/lib/collector-scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JOB_ID_RE = /^[a-f0-9]{32}$/i;

export async function GET(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const jobId = url.searchParams.get('jobId') ?? '';
  if (!JOB_ID_RE.test(jobId)) {
    return NextResponse.json({ error: '任务 ID 无效' }, { status: 400 });
  }
  if (action === 'status') return getJobStatus(jobId, request);
  if (action === 'events') return getJobEvents(jobId, request);
  return NextResponse.json({ error: '未知的调度动作' }, { status: 400 });
}

export async function POST(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;

  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > 8_192) {
    return NextResponse.json({ error: '请求体过大' }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 8_192) {
      return NextResponse.json({ error: '请求体过大' }, { status: 413 });
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 });
    }
    body = parsed;
  } catch {
    return NextResponse.json({ error: '无效 JSON' }, { status: 400 });
  }

  if (body.action === 'submit') {
    return submitDiscoverJob({
      searchKeyword: typeof body.searchKeyword === 'string' ? body.searchKeyword : undefined,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      request,
    });
  }

  if (body.action === 'receive') {
    const jobId = typeof body.jobId === 'string' ? body.jobId : '';
    if (!JOB_ID_RE.test(jobId)) {
      return NextResponse.json({ error: '任务 ID 无效' }, { status: 400 });
    }
    // API routes run on the server: never write to the browser's Zustand/localStorage store here.
    // This temporary adapter lets the shared validator return approved source candidates;
    // the authenticated browser caller performs final local dedupe and persistence.
    const validationStore = {
      customAPIs: [],
      envSources: [],
      addCustomApi: () => undefined,
    };
    const result = await receiveJobResult(validationStore, jobId, request);
    return NextResponse.json(result, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json({ error: '未知的调度动作' }, { status: 400 });
}
