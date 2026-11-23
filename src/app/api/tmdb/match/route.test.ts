import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { fetchTmdbJson } from '@/lib/tmdb';
import { getCache, setCache } from '@/lib/fetch-utils';

vi.mock('@/lib/api-guard', () => ({ guardRequest: vi.fn(() => null) }));
vi.mock('@/lib/tmdb', () => ({ fetchTmdbJson: vi.fn() }));
vi.mock('@/lib/fetch-utils', () => ({
  getCache: vi.fn(() => null),
  setCache: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchTmdbJson);
const mockedGetCache = vi.mocked(getCache);
const mockedSetCache = vi.mocked(setCache);

describe('TMDB artwork identity matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCache.mockReturnValue(undefined as never);
    mockedFetch.mockResolvedValue({ results: [] } as never);
  });

  it('searches localized, CMS alternate and original titles before selecting a year-matched item', async () => {
    mockedFetch
      .mockResolvedValueOnce({ results: [{ id: 42, title: '复仇者联盟4：终局之战', original_title: 'Avengers: Endgame', release_date: '2019-04-24', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg' }] } as never)
      .mockResolvedValueOnce({ results: [] } as never)
      .mockResolvedValueOnce({ results: [{ id: 42, title: '复仇者联盟4：终局之战', original_title: 'Avengers: Endgame', release_date: '2019-04-24', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg' }] } as never);

    const response = await GET(new Request('https://example.test/api/tmdb/match?title=复仇者联盟4：终局之战&alternateTitle=复联4&originalTitle=Avengers%3A%20Endgame&type=movie&year=2019'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.match).toMatchObject({ id: 42, type: 'movie', year: '2019' });
    expect(body.match.posterUrl).toContain('/original/poster.jpg');
    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(mockedFetch).toHaveBeenNthCalledWith(3, '/search/movie', expect.objectContaining({ query: 'Avengers: Endgame' }));
  });

  it('refuses to match when any title alias search fails', async () => {
    mockedFetch
      .mockRejectedValueOnce(new Error('TMDB_HTTP_503'))
      .mockResolvedValueOnce({ results: [
        { id: 42, title: '测试影片', original_title: 'Test Film', release_date: '2020-01-01', poster_path: '/poster.jpg' },
      ] } as never);

    const response = await GET(new Request('https://example.test/api/tmdb/match?title=测试影片&alternateTitle=Test%20Film&type=movie&year=2020'));
    expect(response.status).toBe(200);
    expect((await response.json()).match).toBeNull();
    expect(mockedSetCache).not.toHaveBeenCalled();
  });

  it('does not guess between same-title remakes when no year disambiguates them', async () => {
    mockedFetch.mockResolvedValueOnce({ results: [
      { id: 10, title: '同名电影', original_title: 'Same Film', release_date: '1998-01-01', poster_path: '/a.jpg', backdrop_path: '/a-bg.jpg' },
      { id: 11, title: '同名电影', original_title: 'Same Film', release_date: '2024-01-01', poster_path: '/b.jpg', backdrop_path: '/b-bg.jpg' },
    ] } as never);

    const response = await GET(new Request('https://example.test/api/tmdb/match?title=同名电影&type=movie'));
    expect((await response.json()).match).toBeNull();
  });

  it('does not replace source artwork from a lone title match when year is missing', async () => {
    mockedFetch.mockResolvedValueOnce({ results: [
      { id: 42, title: '测试影片', original_title: 'Test Film', release_date: '2020-01-01', poster_path: '/poster.jpg' },
    ] } as never);

    const response = await GET(new Request('https://example.test/api/tmdb/match?title=测试影片&type=movie'));
    expect((await response.json()).match).toBeNull();
  });

  it('allows a no-year match only when localized and original titles both identify one candidate', async () => {
    mockedFetch
      .mockResolvedValueOnce({ results: [
        { id: 42, title: '测试影片', original_title: 'Test Film', release_date: '2020-01-01', poster_path: '/poster.jpg' },
      ] } as never)
      .mockResolvedValueOnce({ results: [
        { id: 42, title: '测试影片', original_title: 'Test Film', release_date: '2020-01-01', poster_path: '/poster.jpg' },
      ] } as never);

    const response = await GET(new Request('https://example.test/api/tmdb/match?title=测试影片&alternateTitle=Test%20Film&type=movie'));
    expect((await response.json()).match.id).toBe(42);
  });

  it('rejects a candidate whose release year conflicts with the CMS item', async () => {
    mockedFetch.mockResolvedValueOnce({ results: [
      { id: 10, title: '同名电影', original_title: 'Same Film', release_date: '1998-01-01', poster_path: '/a.jpg' },
    ] } as never);

    const response = await GET(new Request('https://example.test/api/tmdb/match?title=同名电影&type=movie&year=2024'));
    expect((await response.json()).match).toBeNull();
  });

  it('validates media type and title before making upstream requests', async () => {
    const response = await GET(new Request('https://example.test/api/tmdb/match?title=测试影片&type=anime'));
    expect(response.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedSetCache).not.toHaveBeenCalled();
  });
});
