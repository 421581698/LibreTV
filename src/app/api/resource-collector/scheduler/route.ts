import { NextResponse } from 'next/server';
import { guardPrivateFeatureRequest } from '@/lib/api-guard';
import {
  discoverCollectorSites,
  getCollectorTaskStatus,
  receiveCollectorTaskResult,
  startCollectorCrawl,
} from '@/lib/collector-scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TASK_ID_RE = /^[a-f0-9]{32}$/i;

export async function GET(request: Request) {
  const guarded = guardPrivateFeatureRequest(request);
  if (guarded) return guarded;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const taskId = url.searchParams.get('taskId') ?? '';
  if (action === 'status') {
    if (!TASK_ID_RE.test(taskId)) return NextResponse.json({ error: '任务 ID 无效' }, { status: 400 });
    return getCollectorTaskStatus(taskId, request);
  }
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

  if (body.action === 'discover') return discoverCollectorSites(request);

  if (body.action === 'crawl') {
    return startCollectorCrawl({
      url: typeof body.url === 'string' ? body.url : '',
      mode: body.mode === 'http' || body.mode === 'browser' ? body.mode : 'auto',
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      searchKeyword: typeof body.searchKeyword === 'string' ? body.searchKeyword : undefined,
      request,
    });
  }

  if (body.action === 'receive') {
    const taskId = typeof body.taskId === 'string' ? body.taskId : '';
    if (!TASK_ID_RE.test(taskId)) return NextResponse.json({ error: '任务 ID 无效' }, { status: 400 });
    // Validate through the Collector's own gated endpoint; only return candidates.
    // The browser performs deduplication and persists sources in its local Zustand store.
    const validationStore = {
      customAPIs: [],
      envSources: [],
      addCustomApi: () => undefined,
    };
    const result = await receiveCollectorTaskResult(validationStore, taskId, request);
    return NextResponse.json(result, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json({ error: '未知的调度动作' }, { status: 400 });
}
