import Dexie, { type EntityTable } from 'dexie';
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
  episodeIndex: number;
  totalEpisodes: number;
  playbackPosition: number;
  duration: number;
  timestamp: number;
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

export type DownloadStatus = 'waiting' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadTaskEntry {
  id: string;
  /** 播放页 m3u8 地址（直连或代理形式，入队时的原样） */
  url: string;
  title: string;
  /** 输出格式 */
  format: 'TS' | 'MP4';
  status: DownloadStatus;
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

export type FavoriteKind = 'fmhy-resource' | 'media' | 'live';

export interface FavoriteEntry {
  id: string;
  kind: FavoriteKind;
  title: string;
  href?: string;
  image?: string;
  category?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface SpatialStateEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

export const db = new Dexie('libretv') as Dexie & {
  history: EntityTable<HistoryEntry, 'id'>;
  progress: EntityTable<ProgressEntry, 'key'>;
  searchHistory: EntityTable<SearchHistoryEntry, 'text'>;
  liveProbe: EntityTable<LiveProbeEntry & { url: string }, 'url'>;
  segmentMeta: EntityTable<SegmentMetaEntry, 'key'>;
  downloads: EntityTable<DownloadTaskEntry, 'id'>;
  fridayTaskEvents: EntityTable<FridayTaskEventEntry, 'eventId'>;
  favorites: EntityTable<FavoriteEntry, 'id'>;
  spatialState: EntityTable<SpatialStateEntry, 'key'>;
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
  const id = `${entry.sourceKey}_${entry.vodId}`;
  const existing = await db.history.get(id);
  const merged: HistoryEntry = {
    ...existing,
    ...entry,
    id,
    playbackPosition: entry.playbackPosition > 10 ? entry.playbackPosition : existing?.playbackPosition ?? 0,
    duration: entry.duration || existing?.duration || 0,
    timestamp: Date.now(),
  };
  await db.history.put(merged);
  // 淘汰最旧记录
  const count = await db.history.count();
  if (count > MAX_HISTORY) {
    const oldest = await db.history.orderBy('timestamp').limit(count - MAX_HISTORY).toArray();
    await db.history.bulkDelete(oldest.map((o) => o.id));
  }
}

export async function updateHistoryProgress(
  sourceKey: string,
  vodId: string,
  position: number,
  duration: number
): Promise<void> {
  const id = `${sourceKey}_${vodId}`;
  const existing = await db.history.get(id);
  if (!existing) return;
  if (Math.abs(existing.playbackPosition - position) < 2 && Math.abs(existing.duration - duration) < 2) return;
  await db.history.update(id, {
    playbackPosition: position,
    duration,
    timestamp: Date.now(),
  });
}

export async function removeHistory(sourceKey: string, vodId: string): Promise<void> {
  await db.history.delete(`${sourceKey}_${vodId}`);
}

export async function clearAllHistory(): Promise<void> {
  // 一并清进度表：否则从历史重新打开时可能取到已清空的旧进度
  await Promise.all([db.history.clear(), db.progress.clear()]);
}

export function progressKeyOf(sourceKey: string, vodId: string, episodeIndex: number): string {
  return `${sourceKey}_${vodId}_${episodeIndex}`;
}

export async function saveProgress(sourceKey: string, vodId: string, episodeIndex: number, position: number, duration: number): Promise<void> {
  if (!duration || position < 1) return;
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
  const progress = await db.progress.toArray();
  const favorites = await db.favorites.toArray();
  const spatialState = await db.spatialState.toArray();
  const settings = localStorage.getItem(PERSIST_KEY);

  const data: Record<string, unknown> = {
    viewingHistory: JSON.stringify(history),
    playbackProgress: JSON.stringify(progress),
    favorites: JSON.stringify(favorites),
    spatialState: JSON.stringify(spatialState),
  };
  if (settings) data[PERSIST_KEY] = settings;

  return JSON.stringify({
    name: 'LibreTV-Settings',
    time: Date.now().toString(),
    cfgVer: '3.0.0',
    data,
  });
}

function isSafeProfileUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function migrateLegacyLiveFavorites(
  urls: string[],
  recent: Array<{ url: string; name: string; logo?: string; group?: string }>
): Promise<void> {
  const recentByUrl = new Map(recent.map((item) => [item.url, item]));
  const entries: FavoriteEntry[] = urls.filter(isSafeProfileUrl).map((url) => {
    const item = recentByUrl.get(url);
    let title = item?.name || url;
    try { title = item?.name || new URL(url).hostname; } catch { /* filtered above */ }
    const now = Date.now();
    return {
      id: favoriteId('live', url),
      kind: 'live',
      title,
      image: isSafeProfileUrl(item?.logo) ? item?.logo : undefined,
      category: item?.group || '直播频道',
      metadata: { streamUrl: url },
      createdAt: now,
      updatedAt: now,
    };
  });
  if (entries.length) {
    const existing = await db.favorites.bulkGet(entries.map((entry) => entry.id));
    const missing = entries.filter((entry, index) => !existing[index]);
    if (missing.length) await db.favorites.bulkAdd(missing);
  }
}

export async function importConfig(content: string): Promise<void> {
  const config = JSON.parse(content) as {
    name?: string;
    data?: Record<string, string>;
  };
  if (config.name !== 'LibreTV-Settings') throw new Error('配置文件格式不正确');
  const data = config.data || {};

  // Parse every supplied section before mutating any store. A malformed later
  // section must not leave earlier stores partially imported.
  const importedFavorites = typeof data['favorites'] === 'string'
    ? JSON.parse(data['favorites']) as unknown
    : undefined;
  const importedSpatialState = typeof data['spatialState'] === 'string'
    ? JSON.parse(data['spatialState']) as unknown
    : undefined;
  const importedHistory = typeof data['viewingHistory'] === 'string'
    ? JSON.parse(data['viewingHistory']) as Record<string, unknown>[]
    : undefined;
  const importedProgress = typeof data['playbackProgress'] === 'string'
    ? JSON.parse(data['playbackProgress']) as unknown
    : undefined;

  await db.transaction('rw', db.favorites, db.spatialState, db.history, db.progress, async () => {
    if (Array.isArray(importedFavorites)) {
      const valid = importedFavorites.filter((item): item is FavoriteEntry =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as FavoriteEntry).id === 'string' &&
        typeof (item as FavoriteEntry).title === 'string' &&
        ['fmhy-resource', 'media', 'live'].includes((item as FavoriteEntry).kind) &&
        ((item as FavoriteEntry).href === undefined || isSafeProfileUrl((item as FavoriteEntry).href)) &&
        ((item as FavoriteEntry).image === undefined || isSafeProfileUrl((item as FavoriteEntry).image))
      ).slice(0, 5000);
      await db.favorites.bulkPut(valid.map((item) => ({
        ...item,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        updatedAt: Date.now(),
      })));
    }

    if (Array.isArray(importedSpatialState)) {
      const valid = importedSpatialState.filter((item): item is SpatialStateEntry =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as SpatialStateEntry).key === 'string' &&
        'value' in (item as object)
      ).slice(0, 100);
      await db.spatialState.bulkPut(valid.map((item) => ({ ...item, updatedAt: Date.now() })));
    }

    if (Array.isArray(importedHistory)) {
      // Compatible with older history records: retain locator metadata only.
      for (const item of importedHistory.slice(0, MAX_HISTORY)) {
        const sourceKey = String(item.sourceKey || item.sourceCode || item.sourceName || '');
        const vodId = String(item.vodId || item.vod_id || '');
        const title = String(item.title || '未知视频');
        if (!sourceKey || !vodId) continue;
        const totalEpisodes = typeof item.totalEpisodes === 'number'
          ? item.totalEpisodes
          : Array.isArray(item.episodes) ? item.episodes.length : 0;
        await upsertHistory({
          sourceKey,
          sourceUrl: typeof item.sourceUrl === 'string' && isSafeProfileUrl(item.sourceUrl) ? item.sourceUrl : undefined,
          vodId,
          title,
          pic: typeof item.pic === 'string' && isSafeProfileUrl(item.pic) ? item.pic : undefined,
          episodeIndex: typeof item.episodeIndex === 'number' ? item.episodeIndex : 0,
          totalEpisodes,
          playbackPosition: typeof item.playbackPosition === 'number' ? item.playbackPosition : 0,
          duration: typeof item.duration === 'number' ? item.duration : 0,
          timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
        });
      }
    }

    if (Array.isArray(importedProgress)) {
      const valid = importedProgress.filter((item): item is ProgressEntry =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as ProgressEntry).key === 'string' &&
        Number.isFinite((item as ProgressEntry).position) &&
        Number.isFinite((item as ProgressEntry).duration)
      ).slice(0, 5000);
      await db.progress.bulkPut(valid.map((item) => ({
        ...item,
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
      })));
    }
  });

  // IndexedDB writes are atomic as one transaction. localStorage is a separate
  // browser storage engine, so write settings only after the Dexie transaction
  // commits and allow quota/security errors to reach the caller.
  if (typeof data[PERSIST_KEY] === 'string') {
    flushPendingPersist();
    localStorage.setItem(PERSIST_KEY, data[PERSIST_KEY]);
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


// v6: local-first unified favorites and V4 spatial workspace preferences.
db.version(6).stores({
  favorites: 'id, kind, createdAt, updatedAt',
  spatialState: 'key, updatedAt',
});

export function favoriteId(kind: FavoriteKind, stableKey: string): string {
  return kind + ':' + stableKey;
}

export async function getFavorite(id: string): Promise<FavoriteEntry | undefined> {
  return db.favorites.get(id);
}

export async function listFavorites(kind?: FavoriteKind): Promise<FavoriteEntry[]> {
  const rows = kind
    ? await db.favorites.where('kind').equals(kind).toArray()
    : await db.favorites.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function upsertFavorite(
  entry: Omit<FavoriteEntry, 'createdAt' | 'updatedAt'> & Partial<Pick<FavoriteEntry, 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const now = Date.now();
  const existing = await db.favorites.get(entry.id);
  await db.favorites.put({
    ...entry,
    createdAt: existing?.createdAt ?? entry.createdAt ?? now,
    updatedAt: now,
  });
}

export async function removeFavorite(id: string): Promise<void> {
  await db.favorites.delete(id);
}

export async function toggleFavorite(
  entry: Omit<FavoriteEntry, 'createdAt' | 'updatedAt'>
): Promise<boolean> {
  const existing = await db.favorites.get(entry.id);
  if (existing) {
    await db.favorites.delete(entry.id);
    return false;
  }
  await upsertFavorite(entry);
  return true;
}

export async function readSpatialState<T = unknown>(key: string): Promise<T | undefined> {
  const entry = await db.spatialState.get(key);
  return entry?.value as T | undefined;
}

export async function writeSpatialState(key: string, value: unknown): Promise<void> {
  await db.spatialState.put({ key, value, updatedAt: Date.now() });
}
