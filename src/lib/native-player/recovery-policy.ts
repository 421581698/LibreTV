export type PlaybackFailureKind = 'network' | 'decode' | 'unsupported' | 'timeout' | 'unknown';
export type RecoveryAction = 'retry-request' | 'recreate-backend' | 'fallback-backend' | 'stop';

export interface RecoveryContext {
  readonly failure: PlaybackFailureKind;
  readonly attempts: number;
  readonly fallbackAvailable: boolean;
  readonly userSelectedQuality: boolean;
}

export interface RecoveryDecision {
  readonly action: RecoveryAction;
  readonly delayMs: number;
  readonly reason: string;
}

/** Deterministic bounded policy. Callers own timers and must guard them by session identity. */
export function decidePlaybackRecovery(context: RecoveryContext): RecoveryDecision {
  if (!Number.isSafeInteger(context.attempts) || context.attempts < 0) {
    return { action: 'stop', delayMs: 0, reason: 'Invalid retry counter.' };
  }
  if (context.failure === 'unsupported') {
    return context.fallbackAvailable
      ? { action: 'fallback-backend', delayMs: 0, reason: 'Current backend cannot decode this source.' }
      : { action: 'stop', delayMs: 0, reason: 'No compatible backend is available.' };
  }
  if (context.attempts >= 3) {
    return context.fallbackAvailable
      ? { action: 'fallback-backend', delayMs: 0, reason: 'Retry budget exhausted; switch backend.' }
      : { action: 'stop', delayMs: 0, reason: 'Retry budget exhausted.' };
  }
  if (context.failure === 'decode') {
    return context.fallbackAvailable
      ? { action: 'recreate-backend', delayMs: 250, reason: 'Decode pipeline stalled; recreate backend once.' }
      : { action: 'stop', delayMs: 0, reason: 'Decode failure has no safe fallback.' };
  }
  const delayMs = Math.min(4000, 500 * (2 ** context.attempts));
  return { action: 'retry-request', delayMs, reason: context.failure === 'network'
    ? 'Transient network failure; retry with bounded backoff.'
    : 'Transient playback failure; retry with bounded backoff.' };
}
