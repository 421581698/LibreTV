import Dexie, { type EntityTable } from 'dexie';
import { favoriteIdFor } from './favorite-id';
import { historyIdFor, progressIdFor } from './history-id';
import type { SourceConfig } from './types';
// 仅类型引入：store.ts 运行时会引用本模块，反向只取类型不会形成运行时循环
import type { LiveProbeEntry } from './store';
import { PERSIST_KEY, flushPendingPersist } from './persist-storage';

/**
 * IndexedDB 持久化（替代旧版 localStorage 数据库）：
 * - 观看历史不再冗余存储全集 URL 列表（旧版长剧 × 50 条极易撑爆 5MB 配额），
 *   只存定位信息（sourceKey+vodId+index），进入播放页时按需重新拉详情，
 *   顺带免费获得「剧集更新同步」能力。
 * - v2：直播测活缓存从 localStorage（随 zustand persist 整体重写）迁入独立表，
 *   高频写入不再拖累设置快照的序列化。
 */

export interface HistoryEntry {
  /** 主键：`${sourceKey}_${vodId}` */
  id: string;
  sourceKey: string;
  sourceUrl?: string;
  vodId: string;
  title: string;
  pic?: string;
  /** 最近一次详情接口提供的真实影片元数据，用于本地个性化推荐 */
  typeName?: string;
  year?: string;
  area?: string;
  episodeIndex: number;
  totalEpisodes: number;
  playbackPosition: number;
  duration: number;
  timestamp: number;
}

export interface FavoriteEntry {
  /** 主键：sourceKey + vodId，确保跨源资源不会互相覆盖 */
  id: string;
  sourceKey: string;
  sourceUrl?: string;
  sourceName: string;
  vodId: string;
  title: string;
  pic?: string;
  typeName?: string;
  year?: string;
  remarks?: string;
  addedAt: number;
}

export interface ProgressEntry {
  key: string; // `${sourceKey}_${vodId}_${episodeIndex}`
  position: number;
  duration: number;
  updatedAt: number;
}

export interface SearchHistoryEntry {
  text: string;
  timestamp: number;
}

export interface SegmentMetaEntry {
  /** Cache Storage 中的 key（归一化的分片绝对地址，或同源代理地址） */
  key: string;
  /** 所属剧集：`${source}:${vodId}:${episodeIndex}`，用于按集淘汰 */
  episodeKey: string;
  /** 片段序号（1 基，便于排查） */
  index: number;
  bytes: number;
  /** 预取时记录的真实耗时（毫秒），loader 命中缓存时合成进 hls.js stats 防 ABR 误判 */
  costMs: number;
  lastAccess: number;
}

export type DownloadStatus = 'queued' | 'waiting' | 'validating' | 'downloading' | 'merging' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'error';

export interface DownloadTaskEntry {
  id: string;
  /** 播放页 m3u8 地址（直连或代理形式，入队时的原样） */
  url: string;
  title: string;
  /** 输出格式 */
  format: 'TS' | 'MP4';
  /** 输入媒体类型，仅作识别与诊断；不会把 m3u8 URL 当成 MP4 文件 */
  sourceFormat?: 'HLS' | 'MP4' | 'OTHER';
  status: DownloadStatus;
  /** 最近一次可操作失败原因 */
  errorMessage?: string;
  finished: number;
  total: number;
  errorNum: number;
  createdAt: number;
  updatedAt: number;
}


// Friday V3 task audit events are stored locally in IndexedDB.
// Event payloads may contain user prompts and source metadata; they remain on this browser.
export interface FridayTaskEventEntry {
  eventId: string;
  taskId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  parentTaskId?: string;
  agent?: string;
  payload?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}

export const db = new Dexie('libretv') as Dexie & {
  history: EntityTable<HistoryEntry, 'id'>;
  favorites: EntityTable<FavoriteEntry, 'id'>;
  progress: EntityTable<ProgressEntry, 'key'>;
  searchHistory: EntityTable<SearchHistoryEntry, 'text'>;
  liveProbe: EntityTable<LiveProbeEntry & { url: string }, 'url'>;
  segmentMeta: EntityTable<SegmentMetaEntry, 'key'>;
  downloads: EntityTable<DownloadTaskEntry, 'id'>;
  fridayTaskEvents: EntityTable<FridayTaskEventEntry, 'eventId'>;
};

db.version(1).stores({
  history: 'id, timestamp',
  progress: 'key, updatedAt',
  searchHistory: 'text, timestamp',
});

// v2 仅新增表；Dexie 会自动继承低版本的表结构
db.version(2).stores({
  liveProbe: 'url',
});

// v3：视频片段缓存元数据（Cache Storage 存字节、这里存 LRU 索引）与离线下载任务
db.version(3).stores({
  segmentMeta: 'key, episodeKey, lastAccess',
  downloads: 'id, createdAt',
});

export const MAX_HISTORY = 100;
export const MAX_SEARCH_HISTORY = 10;

export async function upsertHistory(entry: Omit<HistoryEntry, 'id'>): Promise<void> {
  const id = historyIdFor(entry.sourceKey, entry.vodId);
  // Serialize the merge with progress updates so a stale read cannot overwrite
  // a newer playback position written while this history row is being refreshed.
  await db.transaction('rw', db.history, async () => {
    const existing = await db.history.get(id);
    const sameEpisode = existing?.episodeIndex === entry.episodeIndex;
    const merged: HistoryEntry = {
      ...existing,
      ...entry,
      id,
      typeName: entry.typeName || existing?.typeName,
      year: entry.year || existing?.year,
      area: entry.area || existing?.area,
      // A title-level history row stores only one episode position. Preserve it
      // when reopening the same episode, but never carry it into a different one.
      playbackPosition: entry.playbackPosition > 10
        ? entry.playbackPosition
        : sameEpisode ? existing?.playbackPosition ?? 0 : 0,
      duration: entry.duration || (sameEpisode ? existing?.duration : 0) || 0,
      timestamp: Date.now(),
    };
    await db.history.put(merged);
    // Eviction must share the write transaction or concurrent inserts can
    // exceed MAX_HISTORY and race to delete the wrong set of rows.
    const count = await db.history.count();
    if (count > MAX_HISTORY) {
      const oldest = await db.history.orderBy('timestamp').limit(count - MAX_HISTORY).toArray();
      await db.history.bulkDelete(oldest.map((o) => o.id));
    }
  });
}

export async function updateHistoryProgress(
  sourceKey: string,
  vodId: string,
  position: number,
  duration: number,
  expectedEpisodeIndex?: number
): Promise<void> {
  const id = historyIdFor(sourceKey, vodId);
  // Keep the episode check and write in one read/write transaction. Otherwise an
  // outgoing episode's delayed progress update can race with upsertHistory for
  // the next episode and attach the old position to the new episodeIndex.
  await db.transaction('rw', db.history, async () => {
    const existing = await db.history.get(id);
    if (!existing) return;
    if (expectedEpisodeIndex !== undefined && existing.episodeIndex !== expectedEpisodeIndex) return;
    if (Math.abs(existing.playbackPosition - position) < 2 && Math.abs(existing.duration - duration) < 2) return;
    await db.history.update(id, {
      playbackPosition: position,
      duration,
      timestamp: Date.now(),
    });
  });
}

export async function removeHistory(sourceKey: string, vodId: string): Promise<void> {
  await db.history.delete(historyIdFor(sourceKey, vodId));
}

export async function clearAllHistory(): Promise<void> {
  // 一并清进度表：否则从历史重新打开时可能取到已清空的旧进度
  await db.transaction('rw', db.history, db.progress, async () => {
    await db.history.clear();
    await db.progress.clear();
  });
}

export function progressKeyOf(sourceKey: string, vodId: string, episodeIndex: number): string {
  return progressIdFor(sourceKey, vodId, episodeIndex);
}

export async function saveProgress(sourceKey: string, vodId: string, episodeIndex: number, position: number, duration: number): Promise<void> {
  if (!Number.isInteger(episodeIndex) || episodeIndex < 0 ||
      !Number.isFinite(position) || !Number.isFinite(duration) ||
      position < 1 || duration <= 0) return;
  await db.progress.put({
    key: progressKeyOf(sourceKey, vodId, episodeIndex),
    position,
    duration,
    updatedAt: Date.now(),
  });
}

export async function clearProgress(sourceKey: string, vodId: string, episodeIndex: number): Promise<void> {
  await db.progress.delete(progressKeyOf(sourceKey, vodId, episodeIndex));
}

export async function addSearchHistory(text: string): Promise<void> {
  const t = text.trim().slice(0, 50);
  if (!t) return;
  await db.searchHistory.put({ text: t, timestamp: Date.now() });
  const count = await db.searchHistory.count();
  if (count > MAX_SEARCH_HISTORY) {
    const oldest = await db.searchHistory.orderBy('timestamp').limit(count - MAX_SEARCH_HISTORY).toArray();
    await db.searchHistory.bulkDelete(oldest.map((o) => o.text));
  }
}

export async function removeSearchHistory(text: string): Promise<void> {
  await db.searchHistory.delete(text);
}

export async function clearSearchHistory(): Promise<void> {
  await db.searchHistory.clear();
}

/** 撤销「清空搜索记录」：按原时间戳回填，保持原有顺序 */
export async function restoreSearchHistory(entries: SearchHistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.searchHistory.bulkPut(entries);
}

// —— 直播测活缓存（TTL 过滤由调用方负责，本层只管存取） ——

export async function loadLiveProbeResults(): Promise<Record<string, LiveProbeEntry>> {
  const rows = await db.liveProbe.toArray();
  const out: Record<string, LiveProbeEntry> = {};
  for (const r of rows) out[r.url] = r;
  return out;
}

export async function saveLiveProbeResults(entries: Record<string, LiveProbeEntry>): Promise<void> {
  const rows = Object.entries(entries).map(([url, e]) => ({ ...e, url }));
  if (rows.length > 0) await db.liveProbe.bulkPut(rows);
}

export async function clearLiveProbeResultsDb(): Promise<void> {
  await db.liveProbe.clear();
}

// —— 配置导入导出（兼容旧版 LibreTV-Settings JSON 结构的导出格式） ——

export async function exportConfig(): Promise<string> {
  // 导出前 flush：把节流缓冲中的最新设置落盘，避免导出的是 800ms 前的旧快照
  flushPendingPersist();
  const history = await db.history.toArray();
  const favorites = await db.favorites.toArray();
  const progress = await db.progress.toArray();
  const searchHistory = await db.searchHistory.toArray();
  const settings = localStorage.getItem(PERSIST_KEY);

  const data: Record<string, unknown> = {
    viewingHistory: JSON.stringify(history),
    viewingFavorites: JSON.stringify(favorites),
    viewingProgress: JSON.stringify(progress),
    viewingSearchHistory: JSON.stringify(searchHistory),
  };
  if (settings) data[PERSIST_KEY] = settings;

  return JSON.stringify({
    name: 'LibreTV-Settings',
    time: Date.now().toString(),
    cfgVer: '2.0.0',
    data,
  });
}

export async function importConfig(content: string): Promise<void> {
  const config = JSON.parse(content) as { name?: string; data?: Record<string, unknown> };
  if (config.name !== 'LibreTV-Settings' || !config.data ||
      typeof config.data !== 'object' || Array.isArray(config.data)) {
    throw new Error('配置文件格式不正确');
  }
  const data = config.data;
  const parseEntries = (key: string): Record<string, unknown>[] => {
    const raw = data[key];
    if (raw === undefined) return [];
    if (typeof raw !== 'string') throw new Error(`${key} 不是合法的备份字段`);
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error(`${key} 应为数组`);
    return items.filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item));
  };
  const finiteNonNegative = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  const optional = (item: Record<string, unknown>, key: string): string | undefined =>
    typeof item[key] === 'string' ? item[key] as string : undefined;

  // Parse all sections before changing settings or any IndexedDB table.
  const favorites: FavoriteEntry[] = parseEntries('viewingFavorites')
    .filter((item) => typeof item.sourceKey === 'string' && item.sourceKey.length > 0 &&
      typeof item.vodId === 'string' && item.vodId.length > 0 &&
      typeof item.title === 'string' && typeof item.sourceName === 'string')
    .map((item) => ({
      ...item,
      id: favoriteIdFor(item.sourceKey as string, item.vodId as string),
      addedAt: finiteNonNegative(item.addedAt, Date.now()),
    })) as FavoriteEntry[];
  const history: HistoryEntry[] = parseEntries('viewingHistory')
    .slice(0, MAX_HISTORY).flatMap((item) => {
      // Support the current export (sourceKey/vodId) and legacy fields.
      const sourceKey = optional(item, 'sourceKey') ||
        optional(item, 'sourceCode') || optional(item, 'sourceName') || '';
      const vodId = optional(item, 'vodId') || optional(item, 'vod_id') || '';
      if (!sourceKey || !vodId) return [];
      const entry: HistoryEntry = {
        id: historyIdFor(sourceKey, vodId),
        sourceKey, vodId,
        title: optional(item, 'title') || '未知视频',
        episodeIndex: Math.floor(finiteNonNegative(item.episodeIndex, 0)),
        totalEpisodes: Math.floor(finiteNonNegative(item.totalEpisodes,
          Array.isArray(item.episodes) ? item.episodes.length : 0)),
        playbackPosition: finiteNonNegative(item.playbackPosition, 0),
        duration: finiteNonNegative(item.duration, 0),
        timestamp: finiteNonNegative(item.timestamp, Date.now()),
      };
      for (const field of ['sourceUrl', 'pic', 'typeName', 'year', 'area'] as const) {
        const value = optional(item, field);
        if (value !== undefined) entry[field] = value;
      }
      return [entry];
    });
  const progress: ProgressEntry[] = parseEntries('viewingProgress')
    .filter((item) => typeof item.key === 'string' && item.key.length > 0 &&
      typeof item.position === 'number' && Number.isFinite(item.position) && item.position >= 0 &&
      typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration >= 0)
    .map((item) => ({
      key: item.key as string,
      position: item.position as number,
      duration: item.duration as number,
      updatedAt: finiteNonNegative(item.updatedAt, Date.now()),
    }));
  const searchHistory: SearchHistoryEntry[] = parseEntries('viewingSearchHistory')
    .filter((item) => typeof item.text === 'string' && item.text.length > 0)
    .slice(0, MAX_SEARCH_HISTORY)
    .map((item) => ({
      text: item.text as string,
      timestamp: finiteNonNegative(item.timestamp, Date.now()),
    }));

  const hasSettings = typeof data[PERSIST_KEY] === 'string';
  const settings = hasSettings ? data[PERSIST_KEY] as string : null;
  if (hasSettings) flushPendingPersist();
  const previousSettings = hasSettings ? localStorage.getItem(PERSIST_KEY) : null;
  try {
    if (settings !== null) localStorage.setItem(PERSIST_KEY, settings);
    await db.transaction('rw', db.favorites, db.history, db.progress, db.searchHistory, async () => {
      if (favorites.length) await db.favorites.bulkPut(favorites);
      if (history.length) await db.history.bulkPut(history);
      if (progress.length) await db.progress.bulkPut(progress);
      if (searchHistory.length) await db.searchHistory.bulkPut(searchHistory);
    });
  } catch (error) {
    if (hasSettings) {
      try {
        if (previousSettings === null) localStorage.removeItem(PERSIST_KEY);
        else localStorage.setItem(PERSIST_KEY, previousSettings);
      } catch {
        // Retain the original import failure when browser storage is unavailable.
      }
    }
    throw error;
  }
}

export type { SourceConfig };


// v4: Friday V3 append-only task event log. Compound uniqueness protects task sequence ordering.
db.version(4).stores({
  fridayTaskEvents: 'eventId, taskId, [taskId+sequence], occurredAt, type',
});

// v5: efficiently restore only the 50 most recently created tasks without scanning the full event log.
db.version(5).stores({
  fridayTaskEvents: 'eventId, taskId, [taskId+sequence], occurredAt, type, [type+occurredAt]',
});


// v6: independent movie/series favorites; existing history and live-channel favorites are untouched.
db.version(6).stores({
  favorites: 'id, addedAt, sourceKey, title',
});

// v7: use an unambiguous composite identity and migrate existing v6 favorites.
db.version(7).stores({
  favorites: 'id, addedAt, sourceKey, title',
}).upgrade(async (transaction) => {
  const favorites = transaction.table('favorites');
  const existing = await favorites.toArray();
  await favorites.clear();
  if (existing.length > 0) {
    await favorites.bulkPut(existing.map((item: FavoriteEntry) => ({
      ...item,
      id: favoriteIdFor(item.sourceKey, item.vodId),
    })));
  }
});

// v8: repair legacy history/progress IDs that used ambiguous underscores.
// Migrate within Dexie's versionchange transaction; collisions already stored
// under one old ID cannot be reconstructed and must not be fabricated.
db.version(8).stores({
  history: 'id, timestamp',
  progress: 'key, updatedAt',
}).upgrade(async (transaction) => {
  const history = transaction.table('history');
  const progress = transaction.table('progress');
  const entries = await history.toArray() as HistoryEntry[];
  await history.clear();
  if (entries.length) {
    await history.bulkPut(entries.map((item) => ({
      ...item,
      id: historyIdFor(item.sourceKey, item.vodId),
    })));
  }
  // Old progress keys have no lossless inverse (source/vod can contain '_').
  // Use the known history identities to translate unambiguous matches only.
  const knownPairs = entries.map((entry) => ({
    legacyPrefix: `${entry.sourceKey}_${entry.vodId}_`,
    sourceKey: entry.sourceKey,
    vodId: entry.vodId,
  }));
  const saved = await progress.toArray() as ProgressEntry[];
  await progress.clear();
  if (saved.length) {
    await progress.bulkPut(saved.map((item) => {
      const matches = knownPairs.flatMap((pair) => {
        if (!item.key.startsWith(pair.legacyPrefix)) return [];
        const episode = Number(item.key.slice(pair.legacyPrefix.length));
        return Number.isSafeInteger(episode) && episode >= 0
          ? [progressIdFor(pair.sourceKey, pair.vodId, episode)] : [];
      });
      return matches.length === 1 ? { ...item, key: matches[0] } : item;
    }));
  }
});

export async function addFavorite(entry: Omit<FavoriteEntry, 'id' | 'addedAt'>): Promise<void> {
  const id = favoriteIdFor(entry.sourceKey, entry.vodId);
  const existing = await db.favorites.get(id);
  await db.favorites.put({
    ...existing,
    ...entry,
    id,
    addedAt: existing?.addedAt ?? Date.now(),
  });
}

export async function removeFavorite(sourceKey: string, vodId: string): Promise<void> {
  await db.favorites.delete(favoriteIdFor(sourceKey, vodId));
}
