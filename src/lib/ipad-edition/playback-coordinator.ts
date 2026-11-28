import { api } from '../client-api';
import { getMovieSearchTerms, matchesMovieTitle } from '../movie-title-match';
import { validateSourceUrl } from '../utils';
import type { SearchResultItem, SourceConfig } from '../types';
import { assessIpadMovieIdentity, type IpadMovieIdentity } from './movie-identity';
import { getRejectedIpadResourceKeys, recordIpadResourceVerdict } from './resource-registry';

export interface VerifiedIpadResource {
  item: SearchResultItem;
  source: SourceConfig;
  episodeCount: number;
}

export interface IpadResourceDiagnostic {
  sourceKey: string;
  vodId: string;
  verdict: 'verified' | 'uncertain' | 'rejected' | 'unavailable';
  reasons: readonly string[];
}

export interface IpadResourceSearch {
  expected: IpadMovieIdentity;
  sources: SourceConfig[];
  yellowFilter: boolean;
  signal: AbortSignal;
  excluded?: ReadonlySet<string>;
  maxDetails?: number;
  requiredEpisodeCount?: number;
  rank?: (items: SearchResultItem[]) => SearchResultItem[];
  onDiagnostic?: (record: IpadResourceDiagnostic) => void;
}

export const ipadResourceKey = (sourceKey: string, vodId: string) => sourceKey + ':' + vodId;

/**
 * Shared bounded background discovery for the detail-page Play action and
 * direct player recovery. An exact CMS title is necessary but never sufficient:
 * the provider detail must also pass identity checks and include episodes.
 */
export async function findVerifiedIpadResource(options: IpadResourceSearch): Promise<VerifiedIpadResource | undefined> {
  const { expected, sources, yellowFilter, signal, rank, onDiagnostic } = options;
  if (signal.aborted || !sources.length || !expected.titles.some((title) => title.trim())) return undefined;
  const usableSources = sources.filter((source) => validateSourceUrl(source.url));
  if (!usableSources.length) return undefined;
  const terms = Array.from(new Set(expected.titles.flatMap((title) => getMovieSearchTerms(title)))).slice(0, 6);
  const matches = new Map<string, { item: SearchResultItem; source: SourceConfig }>();
  const knownWrong = getRejectedIpadResourceKeys();
  const diagnose = (record: IpadResourceDiagnostic) => {
    recordIpadResourceVerdict(record);
    onDiagnostic?.(record);
  };

  for (const term of terms) {
    if (signal.aborted) return undefined;
    try {
      const response = await api.search(term, usableSources, yellowFilter, { signal });
      if (signal.aborted) return undefined;
      for (const item of response.list) {
        if (!expected.titles.some((title) => title.trim() && matchesMovieTitle(title, item.name))) continue;
        const source = usableSources.find((candidate) => candidate.key === item.sourceKey);
        if (!source) continue;
        const key = ipadResourceKey(item.sourceKey, String(item.vodId));
        if (options.excluded?.has(key) || knownWrong.has(key) || matches.has(key)) continue;
        matches.set(key, { item, source });
      }
    } catch (error) {
      if (signal.aborted) return undefined;
      // A failed provider must not prevent another enabled provider from working.
      diagnose({ sourceKey: '', vodId: '', verdict: 'unavailable', reasons: [
        error instanceof Error ? error.name : 'search-failed',
      ] });
    }
  }

  const ranked = rank ? rank(Array.from(matches.values(), (value) => value.item)) :
    Array.from(matches.values(), (value) => value.item);
  const maxDetails = Math.min(24, Math.max(1, options.maxDetails ?? 12));
  let inspected = 0;
  for (const candidate of ranked) {
    if (signal.aborted || inspected >= maxDetails) break;
    const entry = matches.get(ipadResourceKey(candidate.sourceKey, String(candidate.vodId)));
    if (!entry) continue;
    inspected += 1;
    const sourceUrl = entry.item.sourceUrl || entry.source.url;
    if (!validateSourceUrl(sourceUrl)) continue;
    try {
      const detail = await api.detail(entry.item.vodId, { ...entry.source, url: sourceUrl }, signal);
      if (signal.aborted) return undefined;
      const verdict = assessIpadMovieIdentity(expected, {
        title: detail.videoInfo?.title || '',
        originalTitle: detail.videoInfo?.originalTitle,
        years: [detail.videoInfo?.year, entry.item.year],
        typeNames: [detail.videoInfo?.typeName, entry.item.typeName],
      });
      const playable = (detail.episodes?.length ?? 0) >= (options.requiredEpisodeCount ?? 1);
      diagnose({ sourceKey: entry.source.key, vodId: String(entry.item.vodId),
        verdict: playable ? verdict.status : 'unavailable',
        reasons: playable ? verdict.reasons : ['no-episodes'] });
      if (verdict.status === 'verified' && playable) {
        return { ...entry, episodeCount: detail.episodes.length };
      }
    } catch (error) {
      if (signal.aborted) return undefined;
      diagnose({ sourceKey: entry.source.key, vodId: String(entry.item.vodId),
        verdict: 'unavailable', reasons: [error instanceof Error ? error.name : 'detail-failed'] });
    }
  }
  return undefined;
}
