import { describe, expect, it } from 'vitest';
import { FMHY_CATEGORIES, parseFmhyMarkdown } from './fmhy-index';

describe('FMHY resource index parser', () => {
  it('declares the 13 official categories', () => {
    expect(FMHY_CATEGORIES).toHaveLength(13);
  });

  it('extracts resource title, canonical URL, domain, description and starred marker', () => {
    const markdown = [
      '* ⭐ **[Example Tool](https://example.org/app)** - A useful **free** tool / [Docs](https://example.org/docs)',
      '* [Second Resource](https://second.example/path) - Another resource',
      '## Not a resource heading',
      '* [Unsafe Scheme](javascript:alert(1)) - ignored',
    ].join(String.fromCharCode(10));

    const results = parseFmhyMarkdown(markdown, 'ai');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: 'Example Tool',
      href: 'https://example.org/app',
      domain: 'example.org',
      categoryId: 'ai',
      starred: true,
    });
    expect(results[0].description).toContain('A useful free tool');
    expect(results[1].title).toBe('Second Resource');
  });

  it('deduplicates canonical links within a category', () => {
    const markdown = [
      '* [Example](https://example.org/)',
      '* [Example duplicate](https://example.org/)',
    ].join(String.fromCharCode(10));
    expect(parseFmhyMarkdown(markdown, 'video')).toHaveLength(1);
  });

  it('rejects unsupported categories', () => {
    expect(parseFmhyMarkdown('* [X](https://x.example)', 'not-real' as never)).toEqual([]);
  });
});
