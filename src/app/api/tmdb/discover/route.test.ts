import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { fetchTmdbJson, getTmdbPosterBase } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

vi.mock('@/lib/api-guard', () => ({ guardRequest: vi.fn(() => null) }));
vi.mock('@/lib/tmdb', () => ({
  fetchTmdbJson: vi.fn(),
  getTmdbPosterBase: vi.fn(),
}));
vi.mock('@/lib/fetch-utils', () => ({
  getCache: vi.fn(() => null),
  setCache: vi.fn(),
}));

const mockedFetchTmdbJson = vi.mocked(fetchTmdbJson);
const mockedPosterBase = vi.mocked(getTmdbPosterBase);
const mockedGetCache = vi.mocked(getCache);
const mockedSetCache = vi.mocked(setCache);

describe('TMDB discover regional and global ranking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCache.mockReturnValue(undefined as never);
    mockedPosterBase.mockResolvedValue('https://image.tmdb.org/t/p/w500');
    mockedFetchTmdbJson.mockResolvedValue({
      results: [{
        id: 123,
        title: '热门影片',
        poster_path: '/poster.jpg',
        vote_average: 8.2,
        release_date: '2026-01-01',
      }],
      total_pages: 4,
    } as never);
  });

  it('uses TMDB popularity ranking globally without filtering by production country', async () => {
    const response = await GET(new Request('https://example.test/api/tmdb/discover?type=movie&tag=热门&page=1&region=GLOBAL'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockedFetchTmdbJson).toHaveBeenCalledWith('/discover/movie', expect.objectContaining({
      language: 'zh-CN',
      include_image_language: 'zh,null,en',
      sort_by: 'popularity.desc',
      page: '1',
      include_adult: 'false',
    }));
    const query = mockedFetchTmdbJson.mock.calls[0][1] as Record<string, string>;
    expect(query).not.toHaveProperty('with_origin_country');
    expect(query).not.toHaveProperty('region');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: '123',
      title: '热门影片',
      cover: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      provider: 'tmdb',
    });
  });

  it('keeps China-origin filtering available for regional shelves', async () => {
    const response = await GET(new Request('https://example.test/api/tmdb/discover?type=movie&tag=热门&page=1'));
    expect(response.status).toBe(200);
    expect(mockedFetchTmdbJson).toHaveBeenCalledWith('/discover/movie', expect.objectContaining({
      with_origin_country: 'CN',
      sort_by: 'popularity.desc',
    }));
  });

  it('uses the same global popularity ordering for TV series', async () => {
    const response = await GET(new Request('https://example.test/api/tmdb/discover?type=tv&tag=热门&page=1&region=GLOBAL'));
    expect(response.status).toBe(200);
    expect(mockedFetchTmdbJson).toHaveBeenCalledWith('/discover/tv', expect.objectContaining({
      language: 'zh-CN',
      sort_by: 'popularity.desc',
    }));
  });

  it('rejects unsupported region values', async () => {
    const response = await GET(new Request('https://example.test/api/tmdb/discover?type=movie&region=JP'));
    expect(response.status).toBe(400);
    expect(mockedFetchTmdbJson).not.toHaveBeenCalled();
    expect(mockedSetCache).not.toHaveBeenCalled();
  });
});
