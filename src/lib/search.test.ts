import { describe, expect, it } from 'vitest';
import { buildSearchUrl } from './search';

describe('buildSearchUrl', () => {
  it('uses the official list action for the BFZY Storm CMS endpoint', () => {
    const url = buildSearchUrl(
      'https://bfzyapi.com/api.php/provide/vod',
      '星际穿越',
      'bfzy',
    );

    expect(url.origin).toBe('https://bfzyapi.com');
    expect(url.pathname).toBe('/api.php/provide/vod');
    expect(url.searchParams.get('ac')).toBe('list');
    expect(url.searchParams.get('wd')).toBe('星际穿越');
  });

  it('recognizes the BFZY host even when a custom source key is used', () => {
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
