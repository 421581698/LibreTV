import type { DoubanItem, SearchResultItem } from '../types';
import type { PosterAsset, PosterProvider, PosterSourceRecord } from './poster-types';

function normalizeHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    if (parsed.username || parsed.password) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** Convert provider records into LibreTV's source-neutral poster asset contract. */
export function createPosterAsset(record: PosterSourceRecord): PosterAsset | undefined {
  const originalUrl = normalizeHttpUrl(record.imageUrl);
  const title = record.title.trim();
  const providerItemId = record.providerItemId.trim();
  if (!originalUrl || !title || !providerItemId) return undefined;

  return {
    id: `${record.provider}:${providerItemId}:${record.kind ?? 'poster'}`,
    provider: record.provider,
    providerItemId,
    title,
    originalUrl,
    kind: record.kind ?? 'poster',
    rights: record.rights ?? 'unknown',
    ...(record.attribution ? { attribution: record.attribution } : {}),
  };
}

export function fromDoubanItem(item: DoubanItem): PosterAsset | undefined {
  return createPosterAsset({
    provider: 'douban',
    providerItemId: item.id,
    title: item.title,
    imageUrl: item.cover,
    kind: 'poster',
  });
}

export function fromBangumiItem(item: DoubanItem): PosterAsset | undefined {
  return createPosterAsset({
    provider: 'bangumi',
    providerItemId: item.id,
    title: item.title,
    imageUrl: item.cover,
    kind: 'poster',
  });
}

export function fromCmsArtwork(input: {
  sourceKey: string;
  vodId: string;
  title: string;
  imageUrl?: string | null;
  kind?: 'poster' | 'backdrop' | 'still';
}): PosterAsset | undefined {
  return createPosterAsset({
    provider: 'cms',
    providerItemId: `${input.sourceKey}:${input.vodId}`,
    title: input.title,
    imageUrl: input.imageUrl,
    kind: input.kind ?? 'poster',
  });
}

export function fromEpisodeArtwork(input: {
  sourceKey: string;
  vodId: string;
  episodeIndex: number;
  title: string;
  imageUrl?: string | null;
  imageSource?: 'tmdb';
  tmdbEpisodeId?: number;
  tmdbSeriesId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
}): PosterAsset | undefined {
  if (input.imageSource === 'tmdb') {
    const episodeIdentity = input.tmdbEpisodeId != null
      ? String(input.tmdbEpisodeId)
      : input.tmdbSeriesId != null && input.seasonNumber != null && input.episodeNumber != null
        ? `${input.tmdbSeriesId}:s${input.seasonNumber}:e${input.episodeNumber}`
        : undefined;
    if (!episodeIdentity) return undefined;
    return createPosterAsset({
      provider: 'tmdb',
      providerItemId: episodeIdentity,
      title: input.title,
      imageUrl: input.imageUrl,
      kind: 'still',
    });
  }
  return fromCmsArtwork({
    sourceKey: input.sourceKey,
    vodId: `${input.vodId}:episode:${input.episodeIndex + 1}`,
    title: input.title,
    imageUrl: input.imageUrl,
    kind: 'still',
  });
}

export function fromCmsSearchResult(item: SearchResultItem): PosterAsset | undefined {
  return fromCmsArtwork({
    sourceKey: item.sourceKey,
    vodId: item.vodId,
    title: item.name,
    imageUrl: item.pic,
  });
}

export function normalizePosterProvider(value: string | undefined): PosterProvider {
  switch (value?.toLowerCase()) {
    case 'douban': return 'douban';
    case 'bangumi': return 'bangumi';
    case 'tmdb': return 'tmdb';
    case 'cms': return 'cms';
    default: return 'unknown';
  }
}
