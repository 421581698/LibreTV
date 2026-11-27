import { log } from './logger';

// 增加 userId 校验与竞态占位 (TOCTOU防御)
type Entry = { userId: string; ctrl: AbortController };
const inflight = new Map<string, Entry>();
const PENDING_CANCEL_TTL_MS = 30_000;
const MAX_PENDING_CANCELLED = 256;
const pendingCancelled = new Map<string, { userId: string; expiresAt: number }>();

function prunePendingCancelled(now = Date.now()): void {
  for (const [id, entry] of pendingCancelled) {
    if (entry.expiresAt <= now) pendingCancelled.delete(id);
  }
  while (pendingCancelled.size > MAX_PENDING_CANCELLED) {
    const oldest = pendingCancelled.keys().next().value;
    if (oldest === undefined) break;
    pendingCancelled.delete(oldest);
  }
}

export function registerInflight(requestId: string, userId: string, ctrl: AbortController): boolean {
  if (inflight.has(requestId)) {
    log.warn('[inflight] 重复 requestId，拒绝注册', { requestId });
    return false;
  }
  inflight.set(requestId, { userId, ctrl });

  // 处理“先取消后注册”的竞态
  prunePendingCancelled();
  const pending = pendingCancelled.get(requestId);
  if (pending) {
    pendingCancelled.delete(requestId);
    if (pending.userId === userId) {
      ctrl.abort(new Error('CANCELLED_BY_CLIENT'));
    }
  }
  return true;
}

export function unregisterInflight(requestId: string) {
  inflight.delete(requestId);
  pendingCancelled.delete(requestId);
}

export type CancelResult = 'ok' | 'pending' | 'forbidden';

export function cancelInflight(requestId: string, userId: string): CancelResult {
  const e = inflight.get(requestId);
  if (e) {
    if (e.userId !== userId) return 'forbidden';
    e.ctrl.abort(new Error('CANCELLED_BY_CLIENT'));
    inflight.delete(requestId);
    return 'ok';
  }
  prunePendingCancelled();
  pendingCancelled.delete(requestId);
  pendingCancelled.set(requestId, { userId, expiresAt: Date.now() + PENDING_CANCEL_TTL_MS });
  prunePendingCancelled();
  return 'pending';
}

export function inflightCount() { return inflight.size; }
