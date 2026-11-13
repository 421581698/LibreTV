import type { SearchResultItem, VideoDetail } from './types';

export const KKPHIM_SOURCE_KEY = 'kkphim';
export const KKPHIM_SOURCE_NAME = 'KKPhim';
export const KKPHIM_API_ORIGIN = 'https://phimapi.com';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, max)
    : '';
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeHttpsUrl(value: unknown): string | undefined {
  const raw = text(value, 2048);
  if (!raw) return undefined;
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function imageUrl(value: unknown, pathImage?: unknown): string | undefined {
  const direct = safeHttpsUrl(value);
  if (direct) return direct;
  const raw = text(value, 1024);
  const base = safeHttpsUrl(pathImage);
  if (!raw || !base || raw.startsWith('/') || raw.includes('..')) return undefined;
  try {
    return new URL(raw, base.endsWith('/') ? base : base + '/').toString();
  } catch {
    return undefined;
  }
}

function movieArray(payload: unknown): UnknownRecord[] {
  const root = record(payload);
  const data = record(root?.data);
  const items = array(data?.items ?? root?.items);
  return items.map(record).filter((item): item is UnknownRecord => Boolean(item));
}

export function normalizeKkphimMovie(
  movie: UnknownRecord,
  pathImage?: unknown,
): SearchResultItem | null {
  const slug = text(movie.slug, 180);
  const name = text(movie.name, 160);
  if (!slug || !/^[\p{L}\p{N}._-]+$/u.test(slug) || !name) return null;

  const categories = array(movie.category)
    .map((item) => text(record(item)?.name, 80))
    .filter(Boolean);
  const countries = array(movie.country)
    .map((item) => text(record(item)?.name, 80))
    .filter(Boolean);

  const quality = text(movie.quality, 24);
  const current = text(movie.episode_current, 48);
  const remarks = [quality, current].filter(Boolean).join(' · ');

  return {
    sourceKey: KKPHIM_SOURCE_KEY,
    sourceName: KKPHIM_SOURCE_NAME,
    sourceUrl: KKPHIM_API_ORIGIN,
    vodId: slug,
    name,
    pic: imageUrl(movie.poster_url ?? movie.thumb_url, pathImage),
    typeName: categories.join(' / ') || text(movie.type, 40),
    year: text(movie.year, 4),
    area: countries.join(' / '),
    remarks: remarks || undefined,
  };
}

export function parseKkphimSearch(payload: unknown): SearchResultItem[] {
  const root = record(payload);
  const data = record(root?.data);
  const pathImage = data?.APP_DOMAIN_CDN_IMAGE ?? root?.pathImage;
  return movieArray(payload)
    .map((movie) => normalizeKkphimMovie(movie, pathImage))
    .filter((item): item is SearchResultItem => Boolean(item));
}

export function parseKkphimDetail(payload: unknown): VideoDetail | null {
  const root = record(payload);
  const movie = record(root?.movie);
  if (!movie) return null;

  const title = text(movie.name, 160);
  const slug = text(movie.slug, 180);
  if (!title || !slug) return null;

  const episodes: string[] = [];
  const episodeLabels: string[] = [];
  const episodeImages: Array<string | undefined> = [];
  for (const server of array(root?.episodes)) {
    const serverRecord = record(server);
    const serverName = text(serverRecord?.server_name, 80) || 'KKPhim';
    for (const episode of array(serverRecord?.server_data)) {
      const item = record(episode);
      const label = text(item?.name, 100);
      const mediaUrl = safeHttpsUrl(item?.link_m3u8);
      const embedUrl = safeHttpsUrl(item?.link_embed);
      const playableUrl = mediaUrl ?? embedUrl;
      if (!label || !playableUrl) continue;
      // Preserve the source's server and episode labels; the detail API exposes
      // both direct HLS and embed URLs, neither of which is treated as verified.
      // VideoDetail.episodes is the existing player contract: each entry is a playable URL.
      // Keep display labels in a parallel optional array rather than leaking CMS delimiters into the player.
      episodes.push(playableUrl);
      episodeLabels.push(`${serverName} · ${label}`);
      episodeImages.push(safeHttpsUrl(item?.still_url ?? item?.still ?? item?.image ?? item?.thumb_url));
    }
  }

  const category = array(movie.category).map((item) => text(record(item)?.name, 80)).filter(Boolean).join(' / ');
  const country = array(movie.country).map((item) => text(record(item)?.name, 80)).filter(Boolean).join(' / ');
  const cover = imageUrl(movie.poster_url ?? movie.thumb_url);
  const actors = array(movie.actor).map((item) => text(item, 100)).filter(Boolean).join(', ');
  const directors = array(movie.director).map((item) => text(item, 100)).filter(Boolean).join(', ');

  return {
    episodes,
    episodeLabels,
    episodeImages,
    videoInfo: {
      title,
      cover,
      desc: text(movie.content, 8000).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      typeName: category || text(movie.type, 40),
      year: text(movie.year, 4),
      area: country,
      director: directors || undefined,
      actor: actors || undefined,
      remarks: [text(movie.quality, 24), text(movie.episode_current, 48)].filter(Boolean).join(' · ') || undefined,
      sourceKey: KKPHIM_SOURCE_KEY,
      sourceName: KKPHIM_SOURCE_NAME,
      sourceUrl: KKPHIM_API_ORIGIN,
    },
  };
}

export function kkphimListItems(payload: unknown): SearchResultItem[] {
  return parseKkphimSearch(payload);
}
