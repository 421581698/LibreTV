import { describe, expect, it } from 'vitest';
import { findMovieMatch, getMovieSearchTerms, matchesMovieTitle } from './movie-title-match';
import type { SearchResultItem } from './types';

const item = (name: string): SearchResultItem => ({
  sourceKey: 'test',
  sourceName: '测试源',
  vodId: '1',
  name,
});

describe('movie title matching', () => {
  it('matches the Spider-Man film by its English title when the homepage uses the Chinese title', () => {
    expect(findMovieMatch('蜘蛛侠：崭新之日', [item('Spider-Man: Brand New Day')])?.name)
      .toBe('Spider-Man: Brand New Day');
  });

  it('matches known Chinese aliases', () => {
    expect(findMovieMatch('蜘蛛侠：崭新之日', [item('蜘蛛侠4')])?.name).toBe('蜘蛛侠4');
    expect(findMovieMatch('蜘蛛侠：崭新之日', [item('蜘蛛侠：英雄重生')])?.name)
      .toBe('蜘蛛侠：英雄重生');
  });

  it('ignores release year and common quality suffixes', () => {
    expect(findMovieMatch('蜘蛛侠：崭新之日', [item('蜘蛛侠：崭新之日 2026 4K')])?.name)
      .toBe('蜘蛛侠：崭新之日 2026 4K');
  });

  it('does not select a different Spider-Man film by loose substring matching', () => {
    expect(findMovieMatch('蜘蛛侠：崭新之日', [item('蜘蛛侠：英雄远征')])).toBeUndefined();
  });

  it('provides original and localized fallback search terms', () => {
    expect(getMovieSearchTerms('蜘蛛侠：崭新之日')).toContain('Spider-Man: Brand New Day');
  });
});

describe('playback identity', () => {
  it('rejects unrelated short drama for Far From Home', () => {
    expect(matchesMovieTitle('蜘蛛侠：英雄远征', '短剧')).toBe(false);
    expect(matchesMovieTitle('蜘蛛侠：英雄远征', '蜘蛛侠：英雄远征（2019）')).toBe(true);
    expect(matchesMovieTitle('蜘蛛侠：英雄远征', '')).toBe(false);
  });
});

it('accepts Far From Home aliases but not other Spider-Man films', () => {
  expect(matchesMovieTitle('蜘蛛侠：英雄远征', 'Spider-Man: Far From Home')).toBe(true);
  expect(matchesMovieTitle('蜘蛛侠：英雄远征', '蜘蛛侠：英雄归来')).toBe(false);
  expect(getMovieSearchTerms('蜘蛛侠：英雄远征')).toContain('Spider-Man: Far From Home');
});
