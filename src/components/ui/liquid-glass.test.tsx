import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiquidGlassSurface } from './liquid-glass';

describe('LiquidGlassSurface v1.0', () => {
  it('keeps the semantic button as the host element', () => {
    const html = renderToStaticMarkup(
      createElement(
        LiquidGlassSurface,
        {
          as: 'button',
          type: 'button',
          interactive: true,
          variant: 'control',
          'aria-label': '搜索',
        },
        createElement('span', null, 'Search'),
      ),
    );

    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="搜索"');
    expect(html).toContain('data-liquid-glass="true"');
    expect(html).toContain('data-liquid-glass-engine="fallback"');
    expect(html).toContain('liquid-glass--interactive');
    expect(html).toContain('Search');
  });

  it('keeps navigation links directly inside the semantic nav host', () => {
    const html = renderToStaticMarkup(
      createElement(
        LiquidGlassSurface,
        {
          as: 'nav',
          variant: 'dock',
          'aria-label': '底部导航',
        },
        createElement('a', { href: '/' }, '首页'),
        createElement('a', { href: '/search' }, '搜索'),
      ),
    );

    expect(html).toContain('<nav');
    expect(html).toContain('<a href="/">首页</a>');
    expect(html).toContain('<a href="/search">搜索</a>');
    expect(html).toContain('data-liquid-glass-engine="fallback"');
  });
});
