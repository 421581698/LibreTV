import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';

const API_BASE = 'https://api.themoviedb.org/3';

export interface TmdbCountry {
  iso_3166_1: string;
  english_name: string;
  native_name: string;
}

export interface TmdbImageConfiguration {
  secure_base_url: string;
  poster_sizes: string[];
  backdrop_sizes: string[];
}

export interface TmdbConfiguration {
  images?: TmdbImageConfiguration;
}

function credentials(): { bearer?: string; apiKey?: string } {
  const bearer = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim() || process.env.METADATA_API_KEY?.trim();
  return {
    ...(bearer ? { bearer } : {}),
    ...(!bearer && apiKey ? { apiKey } : {}),
  };
}

/** TMDB is called only from the server. Prefer the Read Access Token; retain v3-key compatibility. */
export async function fetchTmdb(path: string, params: Record<string, string> = {}): Promise<Response> {
  const auth = credentials();
  if (!auth.bearer && !auth.apiKey) throw new Error('TMDB_NOT_CONFIGURED');

  const url = new URL(path.replace(/^\/+/, ''), `${API_BASE}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (auth.apiKey) url.searchParams.set('api_key', auth.apiKey);

  return fetchUpstream(url.toString(), {
    timeoutMs: 8000,
    retries: 1,
    headers: {
      Accept: 'application/json',
      ...(auth.bearer ? { Authorization: `Bearer ${auth.bearer}` } : {}),
    },
  });
}

export async function fetchTmdbJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const response = await fetchTmdb(path, params);
  if (!response.ok) throw new Error(`TMDB_HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

export function isTmdbCountry(value: unknown): value is TmdbCountry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.iso_3166_1 === 'string' &&
    /^[A-Z]{2}$/.test(item.iso_3166_1) &&
    typeof item.english_name === 'string' &&
    typeof item.native_name === 'string';
}


const IMAGE_CONFIG_CACHE_KEY = 'tmdb:image-configuration';
const IMAGE_CONFIG_TTL = 30 * 24 * 60 * 60 * 1000;

/** Build image URLs from TMDB's official configuration, with a safe documented CDN fallback. */
export async function getTmdbPosterBase(): Promise<string> {
  const cached = getCache<string>(IMAGE_CONFIG_CACHE_KEY);
  if (cached) return cached;

  try {
    const configuration = await fetchTmdbJson<TmdbConfiguration>('/configuration');
    const images = configuration.images;
    const base = images?.secure_base_url;
    if (!base || !base.startsWith('https://image.tmdb.org/t/p/') || !Array.isArray(images?.poster_sizes)) {
      throw new Error('TMDB_INVALID_IMAGE_CONFIGURATION');
    }
    const size = images.poster_sizes.includes('w500')
      ? 'w500'
      : images.poster_sizes.find((candidate) => /^w[0-9]+$/.test(candidate)) || 'original';
    const imageBase = base + size;
    setCache(IMAGE_CONFIG_CACHE_KEY, imageBase, IMAGE_CONFIG_TTL);
    return imageBase;
  } catch {
    return 'https://image.tmdb.org/t/p/w500';
  }
}
