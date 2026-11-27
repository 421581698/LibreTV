import { log } from './logger';
import { watchDistributedCancellation } from './distributed-cancellation';

// 增加 userId 校验与竞态占位 (TOCTOU防御)
type Entry = { userId: string; ctrl: AbortController; stopWatch: () => void };
const inflight = new Map<string, Entry>();
const PENDING_CANCEL_TTL_MS = 30_000;
const MAX_PENDING_CANCELLED = 256;
const pendingCancelled = new Map<string, { userId: string; expiresAt: number }>();
const pendingKey = (requestId: string, userId: string) => JSON.stringify([userId, requestId]);

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
  inflight.set(requestId, { userId, ctrl, stopWatch: watchDistributedCancellation(requestId, userId, ctrl) });

  // 处理“先取消后注册”的竞态
  prunePendingCancelled();
  const key = pendingKey(requestId, userId);
  const pending = pendingCancelled.get(key);
  if (pending) {
    pendingCancelled.delete(key);
    if (pending.userId === userId) {
      ctrl.abort(new Error('CANCELLED_BY_CLIENT'));
    }
  }
  return true;
}

export function unregisterInflight(requestId: string) {
  const entry = inflight.get(requestId);
  entry?.stopWatch();
  inflight.delete(requestId);
  if (entry) pendingCancelled.delete(pendingKey(requestId, entry.userId));
}

export type CancelResult = 'ok' | 'pending' | 'forbidden';

export function cancelInflight(requestId: string, userId: string): CancelResult {
  const e = inflight.get(requestId);
  if (e) {
    if (e.userId !== userId) return 'forbidden';
    e.ctrl.abort(new Error('CANCELLED_BY_CLIENT'));
    e.stopWatch();
    inflight.delete(requestId);
    return 'ok';
  }
  prunePendingCancelled();
  const key = pendingKey(requestId, userId);
  pendingCancelled.delete(key);
  pendingCancelled.set(key, { userId, expiresAt: Date.now() + PENDING_CANCEL_TTL_MS });
  prunePendingCancelled();
  return 'pending';
}

export function inflightCount() { return inflight.size; }
