export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cancelInflight } from '@/lib/infra/inflight';
import { guardRequest } from '@/lib/api-guard';

const RID_RE = /^[A-Za-z0-9_:.-]{1,128}$/;
const MAX_CANCEL_BODY_BYTES = 2048;

async function readCancelBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_CANCEL_BODY_BYTES) throw new Error('TOO_LARGE');
  if (!req.body) throw new Error('INVALID_BODY');
  const reader = req.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > MAX_CANCEL_BODY_BYTES) {
        await reader.cancel();
        throw new Error('TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const full = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { full.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(full));
}

export async function POST(req: NextRequest) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const userId = 'libretv-authenticated-user';

  try {
    const parsed = await readCancelBody(req) as { requestId?: unknown } | null;
    const requestId = parsed && typeof parsed === 'object' ? parsed.requestId : undefined;
    if (typeof requestId !== 'string' || !RID_RE.test(requestId)) {
      return NextResponse.json({ ok: false, message: 'requestId 非法' }, { status: 400 });
    }

    const r = cancelInflight(requestId, userId);
    if (r === 'forbidden') {
      return NextResponse.json({ ok: false, state: r }, { status: 403 });
    }
    return NextResponse.json({ ok: r === 'ok' || r === 'pending', state: r });
  } catch (err) {
    const oversized = err instanceof Error && err.message === 'TOO_LARGE';
    return NextResponse.json(
      { ok: false, error: oversized ? '请求过大' : '请求格式错误' },
      { status: oversized ? 413 : 400 },
    );
  }
}
