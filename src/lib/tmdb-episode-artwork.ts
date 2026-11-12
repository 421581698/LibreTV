import type { VideoDetail } from './types';

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w780';
const REQUEST_TIMEOUT_MS = 5000;

type TmdbTvSearchResult = {
  id?: number;
  name?: string;
  original_name?: string;
  first_air_date?: string;
};

type TmdbSeasonEpisode = {
  id?: number;
  episode_number?: number;
  season_number?: number;
  still_path?: string | null;
};

type TmdbSeasonResponse = {
  episodes?: TmdbSeasonEpisode[];
};

export type TmdbArtworkMatch = {
  image: string;
  tmdbSeriesId: number;
  tmdbEpisodeId?: number;
  seasonNumber: number;
  episodeNumber: number;
  imageSource: 'tmdb';
};

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function parsePositiveInteger(value: string): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function chineseNumber(value: string): number | undefined {
  if (/^\d+$/.test(value)) return parsePositiveInteger(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (digits[value.slice(1)] ?? 0);
  if (value.endsWith('十')) return (digits[value.slice(0, -1)] ?? 1) * 10;
  const parts = value.split('十');
  if (parts.length === 2 && parts[0] in digits && parts[1] in digits) return digits[parts[0]] * 10 + digits[parts[1]];
  if (value in digits) return digits[value];
  return undefined;
}

export function parseEpisodeCoordinates(
  episodeTitle: string,
  seriesTitle: string,
): { seasonNumber: number; episodeNumber: number } | null {
  const seasonMatch = seriesTitle.match(/第\s*(\d+|[一二两三四五六七八九十]+)\s*季/u);
  const seasonNumber = seasonMatch ? chineseNumber(seasonMatch[1]) : 1;
  const patterns = [
    /第\s*(\d+|[一二两三四五六七八九十]+)\s*[集话期]/u,
    /\bS(\d{1,2})\s*E(\d{1,3})\b/i,
    /\b(?:episode|ep)\s*0*(\d{1,3})\b/i,
    /^\s*0*(\d{1,3})\s*$/,
  ];
  let episodeNumber: number | undefined;
  const chinese = episodeTitle.match(patterns[0]);
  if (chinese) episodeNumber = chineseNumber(chinese[1]);
  if (!episodeNumber) {
    const sxe = episodeTitle.match(patterns[1]);
    if (sxe) {
      const explicitSeason = parsePositiveInteger(sxe[1]);
      if (explicitSeason && seasonNumber && explicitSeason !== seasonNumber) return null;
      episodeNumber = parsePositiveInteger(sxe[2]);
    }
  }
  if (!episodeNumber) {
    const english = episodeTitle.match(patterns[2]);
    if (english) episodeNumber = parsePositiveInteger(english[1]);
  }
  if (!episodeNumber) {
    const numeric = episodeTitle.match(patterns[3]);
    if (numeric) episodeNumber = parsePositiveInteger(numeric[1]);
  }
  if (!seasonNumber || !episodeNumber) return null;
  return { seasonNumber, episodeNumber };
}

function extractSeriesTitle(title: string): string {
  return title
    .replace(/第\s*(?:\d+|[一二两三四五六七八九十]+)\s*季.*$/u, '')
    .replace(/\s+S\d{1,2}$/i, '')
    .trim();
}

async function tmdbGet<T>(path: string, token: string, query?: Record<string, string>): Promise<T | null> {
  const url = new URL(TMDB_API + path);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  return await response.json() as T;
}

export async function enrichEpisodesWithTmdbArtwork(
  detail: VideoDetail,
  options: { token?: string; title?: string; originalTitle?: string; year?: string },
): Promise<VideoDetail> {
  const token = options.token?.trim();
  if (!token || !detail.episodeItems?.length) return detail;

  const displayTitle = options.title?.trim() || detail.videoInfo.title?.trim() || '';
  const queryTitle = extractSeriesTitle(displayTitle);
  const aliases = [...new Set([queryTitle, options.originalTitle?.trim()].filter((value): value is string => Boolean(value)))];
  if (aliases.length === 0) return detail;

  try {
    const year = options.year?.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
    const searches = await Promise.all(aliases.map(async (alias) => {
      const searchQuery: Record<string, string> = { query: extractSeriesTitle(alias), include_adult: 'false' };
      if (year) searchQuery.first_air_date_year = year;
      const response = await tmdbGet<{ results?: TmdbTvSearchResult[] }>('/search/tv', token, searchQuery);
      return response?.results ?? [];
    }));
    const normalizedAliases = new Set(aliases.map((alias) => normalizeTitle(extractSeriesTitle(alias))));
    const match = searches.flat().find((item) => {
      if (!Number.isSafeInteger(item.id) || (item.id ?? 0) <= 0) return false;
      const titleMatches = [item.name, item.original_name]
        .some((candidate) => typeof candidate === 'string' && normalizedAliases.has(normalizeTitle(candidate)));
      if (!titleMatches) return false;
      if (!year) return true;
      return typeof item.first_air_date === 'string' && item.first_air_date.startsWith(year + '-');
    });
    if (!match?.id) return detail;

    const seasonNumbers = [...new Set(detail.episodeItems
      .map((item) => parseEpisodeCoordinates(item.title, displayTitle)?.seasonNumber)
      .filter((value): value is number => Boolean(value)))];
    if (seasonNumbers.length === 0) return detail;

    const seasonData = await Promise.all(seasonNumbers.map(async (seasonNumber) => {
      const response = await tmdbGet<TmdbSeasonResponse>(
        '/tv/' + match.id + '/season/' + seasonNumber,
        token,
        { language: 'zh-CN' },
      );
      return { seasonNumber, episodes: response?.episodes ?? [] };
    }));
    const artwork = new Map<string, TmdbArtworkMatch>();
    for (const season of seasonData) {
      for (const episode of season.episodes) {
        const episodeNumber = parsePositiveInteger(String(episode.episode_number ?? ''));
        if (episodeNumber === undefined || !episode.still_path) continue;
        artwork.set(season.seasonNumber + ':' + episodeNumber, {
          image: TMDB_IMAGE + '/' + episode.still_path.replace(/^\/+/, ''),
          tmdbSeriesId: match.id,
          ...(Number.isSafeInteger(episode.id) ? { tmdbEpisodeId: episode.id } : {}),
          seasonNumber: season.seasonNumber,
          episodeNumber,
          imageSource: 'tmdb',
        });
      }
    }

    let changed = false;
    const episodeItems = detail.episodeItems.map((item) => {
      if (item.image) return item;
      const coordinates = parseEpisodeCoordinates(item.title, displayTitle);
      if (!coordinates) return item;
      const matchArtwork = artwork.get(coordinates.seasonNumber + ':' + coordinates.episodeNumber);
      if (!matchArtwork) return item;
      changed = true;
      return {
        ...item,
        image: matchArtwork.image,
        imageSourceUrl: matchArtwork.image,
        imageSourceEpisodeUrl: item.url,
        tmdbSeriesId: matchArtwork.tmdbSeriesId,
        tmdbEpisodeId: matchArtwork.tmdbEpisodeId,
        seasonNumber: matchArtwork.seasonNumber,
        episodeNumber: matchArtwork.episodeNumber,
        imageSource: matchArtwork.imageSource,
      };
    });
    return changed ? { ...detail, episodeItems } : detail;
  } catch {
    // Metadata is optional: TMDB outages, missing credentials, or unmatched titles
    // must never interrupt episode selection or playback.
    return detail;
  }
}
