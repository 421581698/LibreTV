import { describe, expect, it, vi } from 'vitest';
import { createLifecycleTransitionDeduper } from './lifecycle-transition';
describe('lifecycle transition dedupe', () => {
  it('deduplicates visibility hidden and pagehide for one background transition', () => {
    const emit = vi.fn();
    const d = createLifecycleTransitionDeduper(emit);
    expect(d.dispatch('to-background')).toBe(true);
    expect(d.dispatch('to-background')).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it('allows a new cycle after the opposite transition', () => {
    const emit = vi.fn();
    const d = createLifecycleTransitionDeduper(emit);
    d.dispatch('to-background');
    d.dispatch('to-foreground');
    d.dispatch('to-background');
    expect(emit).toHaveBeenCalledTimes(3);
  });
  it('deduplicates repeated online/offline signals', () => {
    const emit = vi.fn();
    const d = createLifecycleTransitionDeduper(emit);
    d.dispatch('offline'); d.dispatch('offline'); d.dispatch('online');
    expect(emit).toHaveBeenCalledTimes(2);
  });
  it('does not dispatch after detach', () => {
    const emit = vi.fn();
    const d = createLifecycleTransitionDeduper(emit);
    d.detach();
    expect(d.dispatch('to-background')).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
