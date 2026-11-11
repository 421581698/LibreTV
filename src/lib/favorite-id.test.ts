import { describe, expect, it } from 'vitest';
import { favoriteIdFor } from './favorite-id';

describe('favoriteIdFor', () => {
  it('returns the same stable identity for the same source and video', () => {
    expect(favoriteIdFor('source-a', 'movie-1')).toBe(favoriteIdFor('source-a', 'movie-1'));
  });

  it('keeps the same video ID from different sources independent', () => {
    expect(favoriteIdFor('source-a', 'movie-1')).not.toBe(favoriteIdFor('source-b', 'movie-1'));
  });

  it('avoids delimiter collisions between source keys and video IDs', () => {
    // A naive `${sourceKey}_${vodId}` key would collide for these pairs.
    expect(favoriteIdFor('source_a', 'movie')).not.toBe(favoriteIdFor('source', 'a_movie'));
  });

  it('preserves exact Unicode and punctuation in both identity parts', () => {
    expect(favoriteIdFor('资源站/一', '电影:2026')).not.toBe(favoriteIdFor('资源站', '一/电影:2026'));
  });
});
