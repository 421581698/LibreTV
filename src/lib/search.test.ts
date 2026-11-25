import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSearchUrl, searchSources } from './search';

describe('buildSearchUrl', () => {
  it('rejects direct URL construction for the disabled BFZY Storm source', () => {
    expect(() => buildSearchUrl(
      'https://bfzyapi.com/api.php/provide/vod',
      '沙丘',
      'custom_0',
    )).toThrow('风暴（BFZY）数据源已停用');
  });

  it('keeps the existing videolist action for other Apple CMS sources', () => {
    const url = buildSearchUrl(
      'https://example.com/api.php/provide/vod',
      '沙丘',
      'custom_0',
    );

    expect(url.searchParams.get('ac')).toBe('videolist');
    expect(url.searchParams.get('wd')).toBe('沙丘');
  });
});


  it('does not schedule a source explicitly marked as restricted even when filtering is disabled', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const outcomes = await searchSources('普通影片', [{
        key: 'restricted-fixture',
        name: 'Restricted fixture',
        url: 'https://restricted-fixture.example/api.php',
        isAdult: true,
      }], { filterAdult: false });
      expect(outcomes).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

describe('disabled BFZY source', () => {
  it('does not schedule the Storm source even when supplied in user configuration', async () => {
    const outcomes = await searchSources('沙丘', [{
      key: 'bfzy',
      name: '风暴',
      url: 'https://bfzyapi.com/api.php/provide/vod',
    }]);
    expect(outcomes).toEqual([]);
  });

  it('does not schedule BFZY when the source has a custom alias', async () => {
    const outcomes = await searchSources('沙丘', [{
      key: 'custom_storm',
      name: '自定义风暴',
      url: 'https://bfzyapi.com/api.php/provide/vod',
    }]);
    expect(outcomes).toEqual([]);
  });
});
