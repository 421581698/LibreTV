export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cancelInflight } from '@/lib/infra/inflight';
import { guardRequest } from '@/lib/api-guard';
import { readJsonLimited, requestBodyErrorStatus } from '@/lib/request-body';

const RID_RE = /^[A-Za-z0-9_:.-]{1,128}$/;

export async function POST(req: NextRequest) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const userId = 'libretv-authenticated-user';

  try {
    const body = await readJsonLimited<{ requestId?: unknown }>(req, 2048);
    const requestId = body && typeof body === 'object' ? body.requestId : undefined;
    if (!requestId || typeof requestId !== 'string' || !RID_RE.test(requestId)) {
      return NextResponse.json({ ok: false, message: 'requestId 非法' }, { status: 400 });
    }

    const r = cancelInflight(requestId, userId);
    if (r === 'forbidden') {
      return NextResponse.json({ ok: false, state: r }, { status: 403 });
    }
    return NextResponse.json({ ok: r === 'ok' || r === 'pending', state: r });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, message: '请求格式错误' },
      { status: requestBodyErrorStatus(err) }
    );
  }
}
