import { describe, expect, it } from 'vitest';
import { AdaptiveQualityGuard } from './adaptive-quality-guard';

describe('AdaptiveQualityGuard', () => {
  it('never overrides a manual quality selection', () => {
    const guard = new AdaptiveQualityGuard();
    expect(guard.onStall({ mode: 'manual', currentLevel: 3, levelCount: 4 })).toEqual({ action: 'none' });
    expect(guard.activeCapLevel).toBeNull();
  });

  it('caps one level below the current rendition after an auto-mode stall', () => {
    const guard = new AdaptiveQualityGuard();
    expect(guard.onStall({ mode: 'auto', currentLevel: 3, levelCount: 4 })).toEqual({
      action: 'cap', capLevel: 2, nextLevel: 2,
    });
    expect(guard.activeCapLevel).toBe(2);
  });

  it('steps the cap down again after another stall at a lower current level', () => {
    const guard = new AdaptiveQualityGuard();
    guard.onStall({ mode: 'auto', currentLevel: 3, levelCount: 4 });
    expect(guard.onStall({ mode: 'auto', currentLevel: 2, levelCount: 4 })).toEqual({
      action: 'cap', capLevel: 1, nextLevel: 1,
    });
  });

  it('does not attempt to go below the lowest available rendition', () => {
    const guard = new AdaptiveQualityGuard();
    expect(guard.onStall({ mode: 'auto', currentLevel: 0, levelCount: 4 })).toEqual({ action: 'none' });
    expect(guard.onStall({ mode: 'auto', currentLevel: 1, levelCount: 1 })).toEqual({ action: 'none' });
  });

  it('restores adaptive selection after three sustainable buffered fragments', () => {
    const guard = new AdaptiveQualityGuard();
    guard.onStall({ mode: 'auto', currentLevel: 3, levelCount: 4 });
    const evidence = {
      mode: 'auto' as const,
      bufferAheadSeconds: 15,
      throughputKbps: 9_000,
      mediaBitrateKbps: 5_000,
    };
    expect(guard.onBufferedFragment(evidence)).toEqual({ action: 'none' });
    expect(guard.onBufferedFragment(evidence)).toEqual({ action: 'none' });
    expect(guard.onBufferedFragment(evidence)).toEqual({ action: 'restore' });
    expect(guard.activeCapLevel).toBeNull();
  });

  it('resets stability progress when buffer or throughput is not sustainable', () => {
    const guard = new AdaptiveQualityGuard();
    guard.onStall({ mode: 'auto', currentLevel: 2, levelCount: 3 });
    const good = { mode: 'auto' as const, bufferAheadSeconds: 15, throughputKbps: 9_000, mediaBitrateKbps: 5_000 };
    const poor = { ...good, bufferAheadSeconds: 4 };
    guard.onBufferedFragment(good);
    guard.onBufferedFragment(poor);
    guard.onBufferedFragment(good);
    guard.onBufferedFragment(good);
    expect(guard.activeCapLevel).toBe(1);
    expect(guard.onBufferedFragment(good)).toEqual({ action: 'restore' });
  });

  it('reset clears any temporary cap', () => {
    const guard = new AdaptiveQualityGuard();
    guard.onStall({ mode: 'auto', currentLevel: 3, levelCount: 4 });
    guard.reset();
    expect(guard.activeCapLevel).toBeNull();
  });
});
