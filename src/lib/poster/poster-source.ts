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

export function fromCmsSearchResult(item: SearchResultItem): PosterAsset | undefined {
  return createPosterAsset({
    provider: 'cms',
    providerItemId: `${item.sourceKey}:${item.vodId}`,
    title: item.name,
    imageUrl: item.pic,
    kind: 'poster',
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
