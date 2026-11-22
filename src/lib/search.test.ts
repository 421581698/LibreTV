import { describe, expect, it } from 'vitest';
import { buildSearchUrl, searchSources } from './search';

describe('buildSearchUrl', () => {
  it('keeps BFZY URL construction isolated from active-source scheduling', () => {
    const url = buildSearchUrl(
      'https://bfzyapi.com/api.php/provide/vod',
      '沙丘',
      'custom_0',
    );

    expect(url.searchParams.get('ac')).toBe('list');
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
