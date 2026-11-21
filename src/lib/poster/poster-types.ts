import type { DoubanItem, SearchResultItem } from '../types';

export type PosterProvider = 'douban' | 'bangumi' | 'tmdb' | 'cms' | 'unknown';
export type PosterImageKind = 'poster' | 'backdrop' | 'still' | 'unknown';
export type PosterAspectClass = 'portrait' | 'landscape' | 'square' | 'unknown';

export interface PosterAsset {
  /** Stable identity within the provider namespace. */
  id: string;
  provider: PosterProvider;
  providerItemId: string;
  title: string;
  /** Untouched source URL; never rewritten for display or persisted as a transformed URL. */
  originalUrl: string;
  kind: PosterImageKind;
  width?: number;
  height?: number;
  aspectRatio?: number;
  aspectClass?: PosterAspectClass;
  /** Rights are unknown unless explicitly supplied by a provider/operator. */
  rights: 'unknown' | 'licensed' | 'public-domain' | 'restricted';
  attribution?: string;
}

export interface PosterSourceRecord {
  provider: PosterProvider;
  providerItemId: string;
  title: string;
  imageUrl?: string | null;
  kind?: PosterImageKind;
  rights?: PosterAsset['rights'];
  attribution?: string;
}

export type PosterInput = DoubanItem | SearchResultItem;
