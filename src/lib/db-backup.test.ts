import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('dexie', () => {
  function makeTable(idKey: string) {
    const rows = new Map<string, Record<string, unknown>>();
    return {
      put: async (entry: Record<string, unknown>) => {
        rows.set(String(entry[idKey]), { ...entry });
      },
      bulkPut: async (entries: Record<string, unknown>[]) => {
        for (const entry of entries) rows.set(String(entry[idKey]), { ...entry });
      },
      toArray: async () => Array.from(rows.values()),
      clear: async () => { rows.clear(); },
      delete: async (key: string) => { rows.delete(key); },
      get: async (key: string) => rows.get(key),
      count: async () => rows.size,
    };
  }
  class MockDexie {
    history = makeTable('id');
    favorites = makeTable('id');
    progress = makeTable('key');
    searchHistory = makeTable('text');
    liveProbe = makeTable('url');
    segmentMeta = makeTable('key');
    downloads = makeTable('id');
    fridayTaskEvents = makeTable('eventId');
    version() {
      return { stores: () => ({ upgrade: () => undefined }) };
    }
    async transaction(...args: unknown[]) {
      const action = args[args.length - 1] as () => Promise<unknown>;
      return action();
    }
  }
  return { default: MockDexie };
});

vi.mock('./persist-storage', () => ({
  PERSIST_KEY: 'libretv-settings',
  flushPendingPersist: vi.fn(),
}));

import { db, exportConfig, importConfig } from './db';

const settings = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => settings.get(key) ?? null,
  setItem: (key: string, value: string) => { settings.set(key, value); },
  removeItem: (key: string) => { settings.delete(key); },
});

afterEach(async () => {
  settings.clear();
  await Promise.all([db.history.clear(), db.favorites.clear(), db.progress.clear(), db.searchHistory.clear()]);
});

describe('config backup/import round trip', () => {
  it('restores modern history fields and exact timestamps, favorites, progress and search history', async () => {
    const history = {
      id: '["s","v"]', sourceKey: 's', vodId: 'v', sourceUrl: 'https://example.com',
      title: 'Movie', pic: 'poster', typeName: 'Drama', year: '2026', area: 'CN',
      episodeIndex: 3, totalEpisodes: 12, playbackPosition: 123, duration: 500,
      timestamp: 1700000000000,
    };
    await db.history.put(history);
    await db.favorites.put({
      id: '["s","v"]', sourceKey: 's', sourceName: 'Source', vodId: 'v',
      title: 'Movie', addedAt: 1700000000001,
    });
    await db.progress.put({ key: 's_v_3', position: 123, duration: 500, updatedAt: 1700000000002 });
    await db.searchHistory.put({ text: 'Movie', timestamp: 1700000000003 });
    settings.set('libretv-settings', '{"state":{"theme":"dark"}}');

    const backup = await exportConfig();
    await Promise.all([db.history.clear(), db.favorites.clear(), db.progress.clear(), db.searchHistory.clear()]);
    settings.clear();
    await importConfig(backup);

    expect(await db.history.toArray()).toEqual([history]);
    expect((await db.favorites.toArray())[0]).toMatchObject({
      sourceKey: 's', vodId: 'v', title: 'Movie', addedAt: 1700000000001,
    });
    expect(await db.progress.toArray()).toEqual([
      { key: 's_v_3', position: 123, duration: 500, updatedAt: 1700000000002 },
    ]);
    expect(await db.searchHistory.toArray()).toEqual([
      { text: 'Movie', timestamp: 1700000000003 },
    ]);
    expect(settings.get('libretv-settings')).toBe('{"state":{"theme":"dark"}}');
  });

  it('migrates legacy history without losing its original playback timestamp', async () => {
    await importConfig(JSON.stringify({
      name: 'LibreTV-Settings',
      data: {
        viewingHistory: JSON.stringify([{
          sourceCode: 'old-source', vod_id: 'old-id', title: 'Classic',
          episodes: ['e1', 'e2'], timestamp: 1700000000000,
        }]),
      },
    }));
    expect((await db.history.toArray())[0]).toMatchObject({
      sourceKey: 'old-source', vodId: 'old-id', totalEpisodes: 2,
      timestamp: 1700000000000,
    });
  });

  it('does not mutate settings when a later backup section is malformed', async () => {
    settings.set('libretv-settings', '{"state":"previous"}');
    await expect(importConfig(JSON.stringify({
      name: 'LibreTV-Settings',
      data: { 'libretv-settings': '{"state":"incoming"}', viewingHistory: '{' },
    }))).rejects.toThrow();
    expect(settings.get('libretv-settings')).toBe('{"state":"previous"}');
  });
});
