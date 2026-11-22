import { describe, expect, it } from 'vitest';
import { buildSearchUrl } from './search';

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
