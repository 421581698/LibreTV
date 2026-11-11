import { describe, expect, it } from 'vitest';
import { favoriteIdFor } from './favorite-id';

describe('favoriteIdFor', () => {
  it('keeps identical IDs from different sources separate', () => {
    expect(favoriteIdFor('source-a', '42')).not.toBe(favoriteIdFor('source-b', '42'));
  });

  it('does not collide when either field contains the legacy separator', () => {
    expect(favoriteIdFor('a_b', 'c')).not.toBe(favoriteIdFor('a', 'b_c'));
  });

  it('is stable for the same source and resource', () => {
    expect(favoriteIdFor('source-a', '42')).toBe(favoriteIdFor('source-a', '42'));
  });
});
