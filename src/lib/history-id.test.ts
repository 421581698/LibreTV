import { describe, expect, it } from 'vitest';
import { historyIdFor, progressIdFor } from './history-id';

describe('history and playback progress identity', () => {
  it('does not collide when source and video IDs include underscores', () => {
    expect(historyIdFor('a_b', 'c')).not.toBe(historyIdFor('a', 'b_c'));
    expect(progressIdFor('a_b', 'c', 1)).not.toBe(progressIdFor('a', 'b_c', 1));
  });
  it('preserves punctuation and Unicode without collisions', () => {
    expect(historyIdFor('资源站/一', '电影:2026')).not.toBe(historyIdFor('资源站', '一/电影:2026'));
  });
});
