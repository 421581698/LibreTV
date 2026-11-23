import type { SearchResultItem } from './types';

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/(?:19|20)\d{2}/g, '')
    .replace(/\b(?:2160p|1080p|720p|4k|uhd|hd|web-?dl|bluray|blu-?ray|中字|国语|粤语|英语|正片)\b/gi, '')
    .replace(/[\s\p{P}\p{S}\p{Z}]+/gu, '');
}

const SPIDER_MAN_BRAND_NEW_DAY_ALIASES = [
  '蜘蛛侠：崭新之日',
  '蜘蛛侠：崭新一天',
  '蜘蛛侠4',
  '蜘蛛侠：英雄重生',
  '蜘蛛人：重生日',
  'Spider-Man: Brand New Day',
  'Spider-Man 4',
] as const;

function aliasesFor(title: string): string[] {
  const normalized = normalizeTitle(title);
  if (
    normalized === normalizeTitle('蜘蛛侠：崭新之日') ||
    normalized === normalizeTitle('Spider-Man: Brand New Day') ||
    normalized === normalizeTitle('Spider-Man 4') ||
    normalized === normalizeTitle('蜘蛛侠4')
  ) {
    return [...SPIDER_MAN_BRAND_NEW_DAY_ALIASES];
  }
  return [title];
}

/** Search using known localized/original titles, without broad fuzzy matches that can open the wrong film. */
export function getMovieSearchTerms(title: string): string[] {
  const seen = new Set<string>();
  return aliasesFor(title).filter((term) => {
    const key = normalizeTitle(term);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Match exact titles after harmless release-year/quality suffix normalization and known aliases. */
export function findMovieMatch(
  title: string,
  items: SearchResultItem[],
): SearchResultItem | undefined {
  const accepted = new Set(getMovieSearchTerms(title).map(normalizeTitle));
  return items.find((item) => accepted.has(normalizeTitle(item.name)));
}
