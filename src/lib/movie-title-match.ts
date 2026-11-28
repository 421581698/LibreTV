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
  const farFromHome = ['蜘蛛侠：英雄远征', '蜘蛛人：离家日', '蜘蛛人：離家日', 'Spider-Man: Far From Home'];
  if (farFromHome.some(alias => normalizeTitle(alias) === normalized)) return farFromHome;
  if (SPIDER_MAN_BRAND_NEW_DAY_ALIASES.some(alias => normalizeTitle(alias) === normalized)) {
    return [...SPIDER_MAN_BRAND_NEW_DAY_ALIASES];
  }
  const homecoming = ['蜘蛛侠：英雄归来', '蜘蛛人：返校日', 'Spider-Man: Homecoming'];
  if (homecoming.some(alias => normalizeTitle(alias) === normalized)) return homecoming;
  const noWayHome = ['蜘蛛侠：英雄无归', '蜘蛛人：無家日', 'Spider-Man: No Way Home'];
  if (noWayHome.some(alias => normalizeTitle(alias) === normalized)) return noWayHome;
  return [title];
}

/** Search using known localized/original titles, without broad fuzzy matches that can open the wrong film. */
export function getMovieSearchTerms(title: string): string[] {
  const aliases = aliasesFor(title);
  const spiderMan = aliases.includes('Spider-Man: Brand New Day');
  // Keep fallback bounded: a title click should not fan out into seven sequential CMS searches.
  const candidates = spiderMan
    ? [title, 'Spider-Man: Brand New Day', '蜘蛛侠4']
    : [title, ...aliases];
  const seen = new Set<string>();
  return candidates.filter((term) => {
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
  const accepted = new Set(aliasesFor(title).map(normalizeTitle));
  return items.find((item) => accepted.has(normalizeTitle(item.name)));
}

/** Fail closed on unrelated playback metadata; do not use substring matches. */
export function matchesMovieTitle(expected: string, actual: string): boolean {
  const key = normalizeTitle(actual);
  return Boolean(key) && aliasesFor(expected).some(title => normalizeTitle(title) === key);
}
