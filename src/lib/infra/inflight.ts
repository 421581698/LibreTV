import { log } from './logger';

// 增加 userId 校验与竞态占位 (TOCTOU防御)
type Entry = { userId: string; ctrl: AbortController };
type PendingCancel = { userId: string; expiresAt: number };
const inflight = new Map<string, Entry>();
const pendingCancelled = new Map<string, PendingCancel>();
const PENDING_CANCEL_TTL_MS = 5_000;
const MAX_PENDING_CANCELS = 1_000;

function prunePendingCancels(now: number): void {
  for (const [requestId, pending] of pendingCancelled) {
    if (pending.expiresAt <= now) pendingCancelled.delete(requestId);
  }
}

export function registerInflight(requestId: string, userId: string, ctrl: AbortController): boolean {
  if (inflight.has(requestId)) {
    log.warn('[inflight] 重复 requestId，拒绝注册', { requestId });
    return false;
  }
  inflight.set(requestId, { userId, ctrl });

  // 处理“先取消后注册”的竞态；占位仅在短窗口内有效。
  const now = Date.now();
  prunePendingCancels(now);
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
  const entry = inflight.get(requestId);
  if (entry) {
    if (entry.userId !== userId) return 'forbidden';
    entry.ctrl.abort(new Error('CANCELLED_BY_CLIENT'));
    inflight.delete(requestId);
    return 'ok';
  }

  const now = Date.now();
  prunePendingCancels(now);
  if (pendingCancelled.size >= MAX_PENDING_CANCELS) {
    const oldestRequestId = pendingCancelled.keys().next().value;
    if (oldestRequestId !== undefined) pendingCancelled.delete(oldestRequestId);
  }
  pendingCancelled.set(requestId, {
    userId,
    expiresAt: now + PENDING_CANCEL_TTL_MS,
  });
  return 'pending';
}

export function inflightCount() { return inflight.size; }
