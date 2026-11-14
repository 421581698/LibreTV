import { describe, expect, it } from 'vitest';
import { favoriteIdFor, normalizeImportedFavorites } from './favorite-id';

describe('favoriteIdFor', () => {
  it('returns the same stable identity for the same source and video', () => {
    expect(favoriteIdFor('source-a', 'movie-1')).toBe(favoriteIdFor('source-a', 'movie-1'));
  });

  it('keeps the same video ID from different sources independent', () => {
    expect(favoriteIdFor('source-a', 'movie-1')).not.toBe(favoriteIdFor('source-b', 'movie-1'));
  });

  it('avoids delimiter collisions between source keys and video IDs', () => {
    expect(favoriteIdFor('source_a', 'movie')).not.toBe(favoriteIdFor('source', 'a_movie'));
  });

  it('preserves exact Unicode and punctuation in both identity parts', () => {
    expect(favoriteIdFor('资源站/一', '电影:2026')).not.toBe(favoriteIdFor('资源站', '一/电影:2026'));
  });
});

describe('normalizeImportedFavorites', () => {
  it('rebuilds primary keys from source and video IDs while preserving metadata', () => {
    const result = normalizeImportedFavorites([{
      id: 'untrusted-legacy-id',
      sourceKey: 'source-a',
      vodId: 'movie-1',
      title: 'Film',
      sourceName: 'Provider A',
      pic: '/poster.jpg',
      addedAt: 123,
    }]);

    expect(result).toEqual([{
      id: favoriteIdFor('source-a', 'movie-1'),
      sourceKey: 'source-a',
      vodId: 'movie-1',
      title: 'Film',
      sourceName: 'Provider A',
      pic: '/poster.jpg',
      addedAt: 123,
    }]);
  });

  it('rejects malformed records and returns an empty list for empty imports', () => {
    const result = normalizeImportedFavorites([
      null,
      {},
      { id: 'x', sourceKey: 'a', vodId: '1', title: 'Film' },
      { id: 1, sourceKey: '', vodId: '2', title: 'Film', sourceName: 'A' },
    ]);

    expect(result).toEqual([]);
    expect(normalizeImportedFavorites([])).toEqual([]);
    expect(normalizeImportedFavorites(null)).toEqual([]);
    expect(normalizeImportedFavorites({ favorites: [] })).toEqual([]);
  });

  it('accepts valid legacy records without an ID and rejects blank identity fields', () => {
    const result = normalizeImportedFavorites([
      { sourceKey: 'legacy-source', vodId: 'legacy-id', title: 'Legacy film', sourceName: 'Legacy' },
      { id: 'x', sourceKey: ' ', vodId: 'id', title: 'Film', sourceName: 'A' },
      { id: 'x', sourceKey: 'a', vodId: '', title: 'Film', sourceName: 'A' },
      { id: 'x', sourceKey: 'a', vodId: '1', title: ' ', sourceName: 'A' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(favoriteIdFor('legacy-source', 'legacy-id'));
  });

  it('keeps identical video IDs from different providers as separate records', () => {
    const result = normalizeImportedFavorites([
      { id: 'same', sourceKey: 'a', vodId: '1', title: 'Film A', sourceName: 'A' },
      { id: 'same', sourceKey: 'b', vodId: '1', title: 'Film B', sourceName: 'B' },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].id).not.toBe(result[1].id);
  });
});
