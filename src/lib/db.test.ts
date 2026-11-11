import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFavorite,
  db,
  exportConfig,
  importConfig,
  removeFavorite,
  type FavoriteEntry,
} from './db';

const favorite = (
  sourceKey: string,
  vodId: string,
  title: string,
): Omit<FavoriteEntry, 'id' | 'addedAt'> => ({
  sourceKey,
  vodId,
  title,
  sourceName: `Provider ${sourceKey}`,
  sourceUrl: `https://${sourceKey}.example`,
  pic: `/${vodId}.jpg`,
});

function settingsExport(favorites: unknown[]): string {
  return JSON.stringify({
    name: 'LibreTV-Settings',
    data: { viewingFavorites: JSON.stringify(favorites) },
  });
}

describe('favorite IndexedDB persistence', () => {
  beforeEach(async () => {
    await db.delete();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } satisfies Storage);
    await db.open();
  });

  afterAll(async () => {
    db.close();
    vi.unstubAllGlobals();
  });

  it('keeps same vodId from different sources independent and removes only the selected source', async () => {
    await addFavorite(favorite('source-a', 'same-id', 'Film A'));
    await addFavorite(favorite('source-b', 'same-id', 'Film B'));

    expect(await db.favorites.count()).toBe(2);

    await removeFavorite('source-a', 'same-id');

    const remaining = await db.favorites.toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sourceKey).toBe('source-b');
    expect(remaining[0].title).toBe('Film B');
  });

  it('updates a source/video record without changing its original addedAt', async () => {
    await addFavorite(favorite('source-a', 'movie-1', 'Old title'));
    const first = await db.favorites.toArray();

    await addFavorite(favorite('source-a', 'movie-1', 'Updated title'));
    const second = await db.favorites.toArray();

    expect(second).toHaveLength(1);
    expect(second[0].title).toBe('Updated title');
    expect(second[0].addedAt).toBe(first[0].addedAt);
  });

  it('round-trips export and import, then remains readable after reopening IndexedDB', async () => {
    await addFavorite(favorite('source-a', 'movie-1', 'Film A'));
    await addFavorite(favorite('source-b', 'movie-1', 'Film B'));

    const exported = await exportConfig();
    await db.favorites.clear();
    expect(await db.favorites.count()).toBe(0);

    await importConfig(exported);
    expect(await db.favorites.count()).toBe(2);

    db.close();
    await db.open();

    const restored = await db.favorites.orderBy('sourceKey').toArray();
    expect(restored.map((item) => [item.sourceKey, item.vodId, item.title])).toEqual([
      ['source-a', 'movie-1', 'Film A'],
      ['source-b', 'movie-1', 'Film B'],
    ]);
  });

  it('rebuilds imported IDs and merges without deleting existing favorites on empty or invalid imports', async () => {
    await addFavorite(favorite('local-source', 'local-id', 'Local favorite'));

    await importConfig(settingsExport([{
      id: 'untrusted-id',
      ...favorite('import-source', 'same-id', 'Imported favorite'),
      addedAt: 42,
    }]));

    const imported = await db.favorites.get(JSON.stringify(['import-source', 'same-id']));
    expect(imported?.id).toBe(JSON.stringify(['import-source', 'same-id']));

    await importConfig(settingsExport([]));
    await importConfig(settingsExport([{ id: 'bad-record' }]));

    expect(await db.favorites.count()).toBe(2);
    expect(await db.favorites.get(JSON.stringify(['local-source', 'local-id']))).toBeDefined();
    expect(imported?.addedAt).toBe(42);
  });
});
