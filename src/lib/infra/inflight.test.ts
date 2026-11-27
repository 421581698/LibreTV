import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelInflight, registerInflight, unregisterInflight } from './inflight';

afterEach(() => { vi.useRealTimers(); });

describe('inflight cancellation bookkeeping', () => {
  it('cancels a request registered after an early cancellation', () => {
    const id = 'pending-register-test';
    expect(cancelInflight(id, 'user')).toBe('pending');
    const controller = new AbortController();
    expect(registerInflight(id, 'user', controller)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    unregisterInflight(id);
  });

  it('ignores cancellation tickets after the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const id = 'expired-register-test';
    expect(cancelInflight(id, 'user')).toBe('pending');
    vi.advanceTimersByTime(30_001);
    const controller = new AbortController();
    registerInflight(id, 'user', controller);
    expect(controller.signal.aborted).toBe(false);
    unregisterInflight(id);
  });

  it('keeps the newest pending IDs within a bounded map', () => {
    for (let i = 0; i < 260; i++) cancelInflight('bounded-' + i, 'user');
    const old = new AbortController();
    registerInflight('bounded-0', 'user', old);
    expect(old.signal.aborted).toBe(false);
    unregisterInflight('bounded-0');
    const recent = new AbortController();
    registerInflight('bounded-259', 'user', recent);
    expect(recent.signal.aborted).toBe(true);
    unregisterInflight('bounded-259');
  });
});
