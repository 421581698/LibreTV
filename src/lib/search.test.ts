import { describe, expect, it } from 'vitest';
import { buildSearchUrl, searchSources } from './search';

describe('buildSearchUrl', () => {
  it('rejects direct URL construction for the disabled BFZY Storm source', () => {
    expect(() => buildSearchUrl(
      'https://bfzyapi.com/api.php/provide/vod',
      '沙丘',
      'custom_0',
    )).toThrow('风暴（BFZY）数据源已停用');
  });

  it.each([
    ['gsm3u8', 'https://api.guangsuapi.com/api.php/provide/vod'],
    ['jsm3u8', 'https://jszyapi.com/api.php/provide/vod'],
    ['wjm3u8', 'https://api.wujinapi.com/api.php/provide/vod'],
    ['hnm3u8', 'https://www.hongniuzy2.com/api.php/provide/vod'],
    ['dbm3u8', 'https://api.apibdzy.com/api.php/provide/vod'],
    ['zuidam3u8', 'https://api.zuidapi.com/api.php/provide/vod'],
  ])('builds a compatible Apple CMS search URL for %s', (key, endpoint) => {
    const url = buildSearchUrl(endpoint, '测试影片', key);
    expect(url.origin + url.pathname).toBe(endpoint);
    expect(url.searchParams.get('ac')).toBe('videolist');
    expect(url.searchParams.get('wd')).toBe('测试影片');
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
