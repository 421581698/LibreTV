import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../client-api';
import { findVerifiedIpadResource } from './playback-coordinator';

const sources = [
  { key: 'bad', name: 'Bad', url: 'https://bad.example/api.php' },
  { key: 'good', name: 'Good', url: 'https://good.example/api.php' },
];

const expected = { titles: ['蜘蛛侠：英雄远征', 'Spider-Man: Far From Home'],
  year: '2019', type: 'movie' as const };

const list = [
  { sourceKey: 'bad', sourceName: 'Bad', vodId: '1', name: '蜘蛛侠：英雄远征', year: '2019' },
  { sourceKey: 'good', sourceName: 'Good', vodId: '2', name: 'Spider-Man: Far From Home', year: '2019' },
];

const mockSearch = () => vi.spyOn(api, 'search').mockResolvedValue({ list, failures: [] } as never);

afterEach(() => vi.restoreAllMocks());

describe('iPad automatic playback coordinator', () => {
  it('skips a differently identified first provider and selects the verified backup', async () => {
    mockSearch();
    const detail = vi.spyOn(api, 'detail').mockImplementation(async (id) => ({
      videoInfo: { title: id === '1' ? 'Spider-Man: Brand New Day' : 'Spider-Man: Far From Home',
        year: id === '1' ? '2026' : '2019', sourceKey: 'unused', sourceName: 'unused' },
      episodes: [{ title: '正片', url: 'https://video.example/film.mp4' }],
    } as never));
    const records: string[] = [];
    const result = await findVerifiedIpadResource({
      expected, sources, yellowFilter: false, signal: new AbortController().signal,
      onDiagnostic: (record) => records.push(record.verdict),
    });
    expect(result?.source.key).toBe('good');
    expect(detail).toHaveBeenCalledTimes(2);
    expect(records).toEqual(['rejected', 'verified']);
  });

  it('never selects a wrong-title search result', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({
      list: [{ sourceKey: 'good', sourceName: 'Good', vodId: '3',
        name: '蜘蛛侠：英雄归来', year: '2017' }], failures: [],
    } as never);
    const detail = vi.spyOn(api, 'detail');
    const result = await findVerifiedIpadResource({
      expected, sources, yellowFilter: false, signal: new AbortController().signal,
    });
    expect(result).toBeUndefined();
    expect(detail).not.toHaveBeenCalled();
  });

  it('does not reuse excluded resources when recovering', async () => {
    mockSearch();
    const detail = vi.spyOn(api, 'detail').mockResolvedValue({
      videoInfo: { title: 'Spider-Man: Far From Home', year: '2019' },
      episodes: [{ title: '正片', url: 'https://video.example/film.mp4' }],
    } as never);
    const result = await findVerifiedIpadResource({
      expected, sources, yellowFilter: false, signal: new AbortController().signal,
      excluded: new Set(['bad:1']),
    });
    expect(result?.item.vodId).toBe('2');
    expect(detail).toHaveBeenCalledTimes(1);
  });

  it('requires a compatible episode index before switching sources', async () => {
    mockSearch();
    vi.spyOn(api, 'detail').mockResolvedValue({
      videoInfo: { title: 'Spider-Man: Far From Home', year: '2019' },
      episodes: [{ title: '正片', url: 'https://video.example/film.mp4' }],
    } as never);
    const result = await findVerifiedIpadResource({
      expected, sources, yellowFilter: false, signal: new AbortController().signal,
      requiredEpisodeCount: 4,
    });
    expect(result).toBeUndefined();
  });

  it('stops immediately on cancelled playback', async () => {
    const search = vi.spyOn(api, 'search');
    const controller = new AbortController();
    controller.abort();
    const result = await findVerifiedIpadResource({
      expected, sources, yellowFilter: false, signal: controller.signal,
    });
    expect(result).toBeUndefined();
    expect(search).not.toHaveBeenCalled();
  });
});
