import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { fetchTmdbJson } from '@/lib/tmdb';
import { getCache } from '@/lib/fetch-utils';

vi.mock('@/lib/api-guard', () => ({ guardRequest: vi.fn(() => null) }));
vi.mock('@/lib/tmdb', () => ({ fetchTmdbJson: vi.fn() }));
vi.mock('@/lib/fetch-utils', () => ({
  getCache: vi.fn(() => null),
  setCache: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchTmdbJson);
const mockedGetCache = vi.mocked(getCache);

describe('TMDB detail artwork resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCache.mockReturnValue(undefined as never);
    mockedFetch.mockResolvedValue({
      id: 42,
      poster_path: '/default-poster.jpg',
      backdrop_path: '/default-backdrop.jpg',
      images: {
        posters: [
          { file_path: '/small-localized.jpg', iso_639_1: 'zh', width: 342, height: 513 },
          { file_path: '/large-original.jpg', iso_639_1: 'en', width: 2000, height: 3000 },
          { file_path: '/wide-poster.jpg', iso_639_1: 'zh', width: 1600, height: 900 },
        ],
        backdrops: [
          { file_path: '/small-backdrop.jpg', iso_639_1: 'zh', width: 1280, height: 720 },
          { file_path: '/large-backdrop.jpg', iso_639_1: null, width: 3840, height: 2160 },
          { file_path: '/portrait-backdrop.jpg', iso_639_1: 'zh', width: 900, height: 1400 },
        ],
      },
    } as never);
  });

  it('returns the highest-resolution correctly oriented poster and backdrop', async () => {
    const response = await GET(new Request('https://example.test/api/tmdb/details?id=42&type=movie'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.poster_path).toBe('/large-original.jpg');
    expect(body.backdrop_path).toBe('/large-backdrop.jpg');
    expect(mockedFetch).toHaveBeenCalledWith('/movie/42', expect.objectContaining({
      append_to_response: 'images,credits,videos,release_dates,content_ratings',
      include_image_language: 'zh,null,en',
    }));
  });

  it('rejects invalid IDs and media types without calling TMDB', async () => {
    const response = await GET(new Request('https://example.test/api/tmdb/details?id=42&type=anime'));
    expect(response.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
