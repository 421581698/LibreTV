import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThrottledStorage } from './persist-storage';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('throttled local storage', () => {
  it('does not resurrect an explicitly removed key after the throttle interval', () => {
    vi.useFakeTimers();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    const storage = createThrottledStorage();
    storage.setItem('libretv-settings', 'stale');
    storage.removeItem('libretv-settings');
    vi.advanceTimersByTime(1200);
    expect(values.has('libretv-settings')).toBe(false);
  });
});
