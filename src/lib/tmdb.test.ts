import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUpstream } from '@/lib/fetch-utils';
import { fetchTmdb, isTmdbCountry } from './tmdb';

vi.mock('@/lib/fetch-utils', () => ({
  fetchUpstream: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchUpstream);

describe('TMDB server client', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the Read Access Token as a Bearer credential', async () => {
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test-read-token');
    mockedFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await fetchTmdb('/configuration/countries', { language: 'zh-CN' });

    expect(mockedFetch).toHaveBeenCalledWith(
      'https://api.themoviedb.org/3/configuration/countries?language=zh-CN',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-read-token',
          Accept: 'application/json',
        }),
      }),
    );
  });

  it('supports the legacy v3 API key without exposing it in headers', async () => {
    vi.stubEnv('TMDB_API_KEY', 'legacy-v3-key');
    mockedFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await fetchTmdb('/discover/movie', { with_origin_country: 'CN' });

    expect(mockedFetch).toHaveBeenCalledWith(
      'https://api.themoviedb.org/3/discover/movie?with_origin_country=CN&api_key=legacy-v3-key',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('fails closed when no TMDB credential is configured', async () => {
    await expect(fetchTmdb('/configuration')).rejects.toThrow('TMDB_NOT_CONFIGURED');
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe('TMDB country validation', () => {
  it('accepts a valid ISO alpha-2 country record', () => {
    expect(isTmdbCountry({ iso_3166_1: 'CN', english_name: 'China', native_name: '中国' })).toBe(true);
  });

  it('rejects malformed or incomplete country records', () => {
    expect(isTmdbCountry({ iso_3166_1: 'CHN', english_name: 'China', native_name: '中国' })).toBe(false);
    expect(isTmdbCountry({ iso_3166_1: 'CN', english_name: 'China' })).toBe(false);
  });
});
