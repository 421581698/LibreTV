import { describe, expect, it } from 'vitest';
import { rankSourcesByHealth } from './source-ranking';

const sources = [{ key: 'unknown' }, { key: 'slow' }, { key: 'fast' }, { key: 'failed' }];

describe('rankSourcesByHealth', () => {
  it('puts recently successful low-latency sources first and keeps unknown sources usable', () => {
    const ranked = rankSourcesByHealth(sources, {
      fast: { ok: true, ms: 120, failStreak: 0, timestamp: 9_000 },
      slow: { ok: true, ms: 900, failStreak: 0, timestamp: 9_000 },
      failed: { ok: false, ms: 2_000, failStreak: 1, timestamp: 9_000 },
    }, 10_000);
    expect(ranked.map((source) => source.key)).toEqual(['fast', 'slow', 'unknown', 'failed']);
  });

  it('ignores stale health and preserves original order for unknown sources', () => {
    const ranked = rankSourcesByHealth(sources, {
      fast: { ok: true, ms: 50, failStreak: 0, timestamp: 1 },
      slow: { ok: true, ms: 800, failStreak: 0, timestamp: 1 },
    }, 8 * 24 * 60 * 60 * 1000);
    expect(ranked.map((source) => source.key)).toEqual(['unknown', 'slow', 'fast', 'failed']);
  });

  it('does not mutate the caller source array', () => {
    const input = [...sources];
    rankSourcesByHealth(input, {}, 10_000);
    expect(input).toEqual(sources);
  });

  it('accepts health exactly at the seven-day boundary and ignores future timestamps', () => {
    const now = 8 * 24 * 60 * 60 * 1000;
    const ranked = rankSourcesByHealth(sources, {
      slow: { ok: true, ms: 800, failStreak: 0, timestamp: now - 7 * 24 * 60 * 60 * 1000 },
      fast: { ok: true, ms: 50, failStreak: 0, timestamp: now + 1 },
    }, now);
    expect(ranked.map((source) => source.key)).toEqual(['slow', 'unknown', 'fast', 'failed']);
  });

});