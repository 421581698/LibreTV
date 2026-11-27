export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { HISTORY_LIMITS } from '@/types/chat';
import { runChat } from '@/lib/orchestrator';
import { registerInflight, unregisterInflight } from '@/lib/infra/inflight';
import { inspectInput } from '@/lib/infra/guard';
import { guardRequest } from '@/lib/api-guard';

const MAX_BODY_BYTES = 128 * 1024;
const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(HISTORY_LIMITS.maxContentChars),
  cards: z.array(z.object({
    id: z.string().max(200),
    title: z.string().max(200),
  })).max(HISTORY_LIMITS.maxCardsPerMessage).optional(),
});
const chatSchema = z.object({ messages: z.array(messageSchema).min(1).max(30) });

async function readBoundedBody(request: Request): Promise<unknown> {
  const declaredBytes = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) throw new Error('TOO_LARGE');
  if (!request.body) throw new Error('BAD_BODY');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function POST(req: NextRequest) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const userId = 'libretv-authenticated-user';
  let requestId: string | undefined;
  
  let body: z.infer<typeof chatSchema>;
  try {
    const parsed = chatSchema.safeParse(await readBoundedBody(req));
    if (!parsed.success) {
      return NextResponse.json({ error: '聊天消息格式或长度不正确' }, { status: 400 });
    }
    body = parsed.data;
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'TOO_LARGE';
    return NextResponse.json(
      { error: tooLarge ? '请求体超过 128KB' : '请求格式错误' },
      { status: tooLarge ? 413 : 400 },
    );
  }

  try {
    // Preserve the legacy messages contract while validating every history entry.
    const userMessage = body.messages[body.messages.length - 1].content;
    const history = body.messages.slice(0, -1);

    const input = inspectInput(userMessage);
    if (!input.ok) {
      return NextResponse.json({ error: input.reason }, { status: 400 });
    }

    // 自动生成 requestId
    requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const conversationId = 'libretv_session';

    const ctrl = new AbortController();
    if (!registerInflight(requestId, userId, ctrl)) throw new Error('重复的聊天请求标识');
    req.signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    // 调用咱们写好的核心大脑！
    const stream = await runChat(
      userMessage,
      history,
      requestId,
      conversationId,
      userId,
      ctrl.signal
    );

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    if (requestId) unregisterInflight(requestId);
    return NextResponse.json({ error: 'AI 服务暂时不可用' }, { status: 500 });
  }
}
