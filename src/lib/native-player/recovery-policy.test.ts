import { describe, expect, it } from 'vitest';
import { decidePlaybackRecovery } from './recovery-policy';

describe('playback recovery policy', () => {
  it('uses bounded exponential backoff for network failures', () => {
    expect(decidePlaybackRecovery({ failure: 'network', attempts: 0, fallbackAvailable: true, userSelectedQuality: false }).delayMs).toBe(500);
    expect(decidePlaybackRecovery({ failure: 'network', attempts: 2, fallbackAvailable: true, userSelectedQuality: false }).delayMs).toBe(2000);
  });

  it('never silently changes a user-selected quality in its decision model', () => {
    expect(decidePlaybackRecovery({ failure: 'network', attempts: 1, fallbackAvailable: true, userSelectedQuality: true }).action).toBe('retry-request');
  });

  it('falls back or stops when retries are exhausted', () => {
    expect(decidePlaybackRecovery({ failure: 'timeout', attempts: 3, fallbackAvailable: true, userSelectedQuality: false }).action).toBe('fallback-backend');
    expect(decidePlaybackRecovery({ failure: 'decode', attempts: 0, fallbackAvailable: false, userSelectedQuality: false }).action).toBe('stop');
  });
});
