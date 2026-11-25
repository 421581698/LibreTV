import { describe, expect, it, vi } from 'vitest';
import type { RecoveryDecision } from './playback-recovery';
import {
  PHASE1_AUTO_RECOVERY_POLICY,
  STALL_DEGRADED_THRESHOLD_MS,
  STALL_SWITCH_THRESHOLD_MS,
  applyStallDecision,
  getAutoRecoveryMode,
  resolveRecoveryAction,
  resolveStallAction,
  type AutoRecoveryPolicy,
} from './playback-auto-policy';

describe('PHASE1_AUTO_RECOVERY_POLICY', () => {
  it('keeps every automatic recovery action disabled', () => {
    expect(PHASE1_AUTO_RECOVERY_POLICY).toEqual({
      autoSwitchSource: false,
      autoRetry: false,
      autoRecoverMedia: false,
      autoQualityDowngrade: false,
    });
  });

  it('is frozen so the Phase 1 default cannot be mutated in place', () => {
    expect(Object.isFrozen(PHASE1_AUTO_RECOVERY_POLICY)).toBe(true);
  });

  it('reports the telemetry mode as read-only', () => {
    expect(getAutoRecoveryMode()).toBe('read-only');
    expect(getAutoRecoveryMode({ ...PHASE1_AUTO_RECOVERY_POLICY, autoRetry: true })).toBe('enabled');
  });
});

describe('resolveRecoveryAction — Phase 1 strict read-only', () => {
  const cases: Array<{ decision: RecoveryDecision; wouldHave: RecoveryDecision['action'] }> = [
    { decision: { action: 'retry', delayMs: 500, attempt: 1, reason: 'network retry' }, wouldHave: 'retry' },
    { decision: { action: 'recover-media', swapAudio: false, attempt: 1, reason: 'media recover' }, wouldHave: 'recover-media' },
    { decision: { action: 'switch-source', reason: 'manifest unparsable' }, wouldHave: 'switch-source' },
  ];

  it.each(cases)('turns $wouldHave into observe-only instead of acting', ({ decision, wouldHave }) => {
    const result = resolveRecoveryAction(decision);
    expect(result.action).toBe('observe-only');
    if (result.action === 'observe-only') {
      expect(result.wouldHave).toBe(wouldHave);
      expect(result.reason).toBe(decision.reason);
    }
  });

  it('never lets a fatal error open the source-switch panel', () => {
    const decision: RecoveryDecision = { action: 'switch-source', reason: 'fatal' };
    const result = resolveRecoveryAction(decision);
    expect(result.action).not.toBe('switch-source');
  });

  it('does not retry a load or recover the media element', () => {
    expect(resolveRecoveryAction({ action: 'retry', delayMs: 0, attempt: 2, reason: 'r' }).action)
      .not.toBe('retry');
    expect(resolveRecoveryAction({ action: 'recover-media', swapAudio: true, attempt: 1, reason: 'r' }).action)
      .not.toBe('recover-media');
  });

  it('preserves ignore decisions', () => {
    const decision: RecoveryDecision = { action: 'ignore', reason: 'disposed' };
    expect(resolveRecoveryAction(decision)).toBe(decision);
  });

  it('permits an action only when its matching policy flag is enabled', () => {
    const enabled: AutoRecoveryPolicy = {
      autoSwitchSource: true,
      autoRetry: true,
      autoRecoverMedia: true,
      autoQualityDowngrade: true,
    };
    expect(resolveRecoveryAction({ action: 'retry', delayMs: 0, attempt: 1, reason: 'r' }, enabled).action)
      .toBe('retry');
    expect(resolveRecoveryAction({ action: 'recover-media', swapAudio: false, attempt: 1, reason: 'r' }, enabled).action)
      .toBe('recover-media');
    expect(resolveRecoveryAction({ action: 'switch-source', reason: 'r' }, enabled).action)
      .toBe('switch-source');
  });

  it('enabling one flag does not enable the others', () => {
    const onlySwitch: AutoRecoveryPolicy = { ...PHASE1_AUTO_RECOVERY_POLICY, autoSwitchSource: true };
    expect(resolveRecoveryAction({ action: 'switch-source', reason: 'r' }, onlySwitch).action)
      .toBe('switch-source');
    expect(resolveRecoveryAction({ action: 'retry', delayMs: 0, attempt: 1, reason: 'r' }, onlySwitch).action)
      .toBe('observe-only');
    expect(resolveRecoveryAction({ action: 'recover-media', swapAudio: false, attempt: 1, reason: 'r' }, onlySwitch).action)
      .toBe('observe-only');
  });
});

describe('resolveStallAction — 12s timeout must not switch source', () => {
  it('reports observe-only for a 12s stall in Phase 1', () => {
    const result = resolveStallAction(STALL_SWITCH_THRESHOLD_MS);
    expect(result.action).toBe('observe-only');
    expect(result.action).not.toBe('switch-source');
    expect(result.status).toBe('stalled');
    expect(result.stalledMs).toBe(12_000);
    expect(result.reason).toContain('12 秒');
  });

  it('reports a longer stall as degraded, still without switching', () => {
    const result = resolveStallAction(STALL_DEGRADED_THRESHOLD_MS);
    expect(result.action).toBe('observe-only');
    expect(result.status).toBe('degraded');
  });

  it('keeps the reason string so the observation can be reported', () => {
    const result = resolveStallAction(18_000);
    expect(result.reason).toContain('18 秒');
    expect(result.stalledMs).toBe(18_000);
  });

  it('only switches after the threshold when autoSwitchSource is explicitly enabled', () => {
    const enabled: AutoRecoveryPolicy = { ...PHASE1_AUTO_RECOVERY_POLICY, autoSwitchSource: true };
    expect(resolveStallAction(STALL_SWITCH_THRESHOLD_MS, enabled).action).toBe('switch-source');
    expect(resolveStallAction(STALL_SWITCH_THRESHOLD_MS - 1, enabled).action).toBe('observe-only');
  });
});

describe('applyStallDecision — the exact path the player timeout handler runs', () => {
  it('never calls onSwitchSource on a 12s timeout in Phase 1', () => {
    const onSwitchSource = vi.fn();
    const onObserve = vi.fn();
    const result = applyStallDecision(resolveStallAction(12_000), { onSwitchSource, onObserve });

    expect(result).toBe('observed');
    expect(onSwitchSource).not.toHaveBeenCalled();
    expect(onObserve).toHaveBeenCalledOnce();
  });

  it('reports the observation so telemetry still records the stall', () => {
    const onObserve = vi.fn();
    applyStallDecision(resolveStallAction(35_000), { onSwitchSource: vi.fn(), onObserve });
    expect(onObserve).toHaveBeenCalledWith(expect.objectContaining({
      action: 'observe-only',
      status: 'degraded',
      stalledMs: 35_000,
    }));
  });

  it('does switch once autoSwitchSource is explicitly enabled', () => {
    const onSwitchSource = vi.fn();
    const enabled: AutoRecoveryPolicy = { ...PHASE1_AUTO_RECOVERY_POLICY, autoSwitchSource: true };
    const result = applyStallDecision(resolveStallAction(12_000, enabled), {
      onSwitchSource,
      onObserve: vi.fn(),
    });
    expect(result).toBe('switched');
    expect(onSwitchSource).toHaveBeenCalledWith(expect.stringContaining('12 秒'));
  });

  it('keeps user-initiated switching independent of the policy', () => {
    expect(typeof applyStallDecision).toBe('function');
    expect(typeof resolveRecoveryAction).toBe('function');
    expect(typeof resolveStallAction).toBe('function');
  });
});
