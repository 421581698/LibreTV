/**
 * Playback auto-recovery policy — Phase 1 (strict read-only diagnostics).
 *
 * Phase 1 rule: detect and report, never act automatically. Automatic source
 * switching, load retries, media-error recovery (detach/attach) and any
 * strategy-driven quality downgrade are all disabled by default.
 *
 * These are pure functions with no browser/React dependencies so that the
 * "a 12s stall must never trigger onRequestSwitchSource" rule can be proven by
 * unit tests without rendering the player (this repo has no React test
 * renderer). The player must route every automatic action through these
 * decision functions.
 */

import type { RecoveryDecision } from './playback-recovery';

export interface AutoRecoveryPolicy {
  /** 12s stall / fatal error -> open the source-switch panel. */
  autoSwitchSource: boolean;
  /** Fatal network error -> retry startLoad (may fall back to proxy). */
  autoRetry: boolean;
  /** Fatal media error -> recoverMediaError (detach/attach = playback restart). */
  autoRecoverMedia: boolean;
  /**
   * Strategy-driven quality downgrade. Reserved switch: no such strategy
   * exists in the player today, and ABR under a user-selected `auto`
   * preference is not a policy downgrade. Kept explicit so the Phase 1
   * boundary is unambiguous and testable.
   */
  autoQualityDowngrade: boolean;
}

/** Phase 1: strict read-only. Every automatic action is off. */
export const PHASE1_AUTO_RECOVERY_POLICY: Readonly<AutoRecoveryPolicy> = Object.freeze({
  autoSwitchSource: false,
  autoRetry: false,
  autoRecoverMedia: false,
  autoQualityDowngrade: false,
});

/** Telemetry label derived from the policy, never hardcoded out of sync. */
export function getAutoRecoveryMode(
  policy: Readonly<AutoRecoveryPolicy> = PHASE1_AUTO_RECOVERY_POLICY,
): 'read-only' | 'enabled' {
  return policy.autoSwitchSource || policy.autoRetry || policy.autoRecoverMedia || policy.autoQualityDowngrade
    ? 'enabled'
    : 'read-only';
}

export interface ObservedDecision {
  action: 'observe-only';
  reason: string;
  /** Which action would have run if the policy allowed it. Diagnostic only. */
  wouldHave: RecoveryDecision['action'];
}

export type EffectiveRecoveryDecision = RecoveryDecision | ObservedDecision;

/**
 * Map a recovery decision to the action actually allowed by policy.
 *
 * In Phase 1 every active recovery becomes `observe-only`: the caller must
 * record the observation and report it, but must not switch source, retry the
 * load, recover the media element, or downgrade quality. `ignore` stays ignore.
 */
export function resolveRecoveryAction(
  decision: RecoveryDecision,
  policy: Readonly<AutoRecoveryPolicy> = PHASE1_AUTO_RECOVERY_POLICY,
): EffectiveRecoveryDecision {
  const allowed =
    decision.action === 'ignore' ||
    (decision.action === 'retry' && policy.autoRetry) ||
    (decision.action === 'recover-media' && policy.autoRecoverMedia) ||
    (decision.action === 'switch-source' && policy.autoSwitchSource);

  return allowed
    ? decision
    : { action: 'observe-only', reason: decision.reason, wouldHave: decision.action };
}

export type StallStatus = 'stalled' | 'degraded';

export interface StallDecisionBase {
  reason: string;
  stalledMs: number;
  status: StallStatus;
}

export interface StallSwitchDecision extends StallDecisionBase {
  action: 'switch-source';
}

export interface StallObserveDecision extends StallDecisionBase {
  action: 'observe-only';
}

export type StallDecision = StallSwitchDecision | StallObserveDecision;

/** Threshold after which a post-playback stall used to open source switching. */
export const STALL_SWITCH_THRESHOLD_MS = 12_000;
/** Longer stalls are reported as degraded rather than merely stalled. */
export const STALL_DEGRADED_THRESHOLD_MS = 30_000;

export interface StallActions {
  /** Called only when the policy allows an automatic source switch. */
  onSwitchSource: (reason: string) => void;
  /** Called when the stall is observation-only (always the case in Phase 1). */
  onObserve: (decision: StallObserveDecision) => void;
}

/**
 * Execute a stall decision through injected side-effect handlers.
 *
 * The player's 12s timeout handler and the unit tests both call this function,
 * so the "Phase 1 never calls onRequestSwitchSource on timeout" guarantee is
 * enforced against the exact code path that runs in production — not a test
 *-only copy. In Phase 1 `onSwitchSource` is never invoked.
 */
export function applyStallDecision(
  decision: StallDecision,
  actions: StallActions,
): 'switched' | 'observed' {
  if (decision.action === 'switch-source') {
    actions.onSwitchSource(decision.reason);
    return 'switched';
  }
  actions.onObserve(decision);
  return 'observed';
}

/**
 * Decide what a post-playback stall should do.
 *
 * Phase 1 always returns `observe-only`, so the player's timeout handler never
 * calls `onRequestSwitchSource`. `stalled` / `degraded` status is returned for
 * telemetry reporting only.
 */
export function resolveStallAction(
  stalledMs: number,
  policy: Readonly<AutoRecoveryPolicy> = PHASE1_AUTO_RECOVERY_POLICY,
): StallDecision {
  const status: StallStatus = stalledMs >= STALL_DEGRADED_THRESHOLD_MS ? 'degraded' : 'stalled';
  const reason = `视频持续缓冲超过 ${Math.round(stalledMs / 1000)} 秒`;

  if (policy.autoSwitchSource && stalledMs >= STALL_SWITCH_THRESHOLD_MS) {
    return { action: 'switch-source', reason, stalledMs, status };
  }
  return { action: 'observe-only', reason, stalledMs, status };
}
