import { describe, expect, it } from 'vitest';
import { matchesIpadMovieIdentity } from './movie-identity';

describe('iPad movie identity / Spider-Man regression', () => {
  const expected = { titles: ['蜘蛛侠：英雄远征', 'Spider-Man: Far From Home'], year: '2019', type: 'movie' as const };
  const actual = (extra: Record<string, unknown> = {}) => ({
    title: 'Spider-Man: Far From Home', years: ['2019'], typeNames: ['科幻'], ...extra,
  });
  it('accepts the original English title', () => expect(matchesIpadMovieIdentity(expected, actual())).toBe(true));
  it('accepts the traditional-Chinese alias', () => expect(matchesIpadMovieIdentity(expected, actual({ title: '蜘蛛人：離家日' }))).toBe(true));
  it('rejects Brand New Day', () => expect(matchesIpadMovieIdentity(expected, actual({ title: 'Spider-Man: Brand New Day' }))).toBe(false));
  it('rejects Homecoming', () => expect(matchesIpadMovieIdentity(expected, actual({ title: '蜘蛛侠：英雄归来' }))).toBe(false));
  it('rejects a conflicting detail year', () => expect(matchesIpadMovieIdentity(expected, actual({ years: ['2026'] }))).toBe(false));
  it('rejects conflicting search metadata even when the detail year matches', () => expect(matchesIpadMovieIdentity(expected, actual({ years: ['2019', '2026'] }))).toBe(false));
  it('rejects an unrelated original title', () => expect(matchesIpadMovieIdentity(expected, actual({ originalTitle: 'Spider-Man: Brand New Day' }))).toBe(false));
  it('rejects a TV series', () => expect(matchesIpadMovieIdentity(expected, actual({ typeNames: ['电视剧'] }))).toBe(false));
  it('rejects short drama', () => expect(matchesIpadMovieIdentity(expected, actual({ typeNames: ['短剧'] }))).toBe(false));
  it('accepts unknown optional metadata', () => expect(matchesIpadMovieIdentity(expected, actual({ years: [], typeNames: [] }))).toBe(true));
  it('parses years with date suffixes', () => expect(matchesIpadMovieIdentity(expected, actual({ years: ['2019年', '2019-06-28'] }))).toBe(true));
  it('rejects films for series', () => expect(matchesIpadMovieIdentity({ ...expected, type: 'tv' }, actual({ typeNames: ['电影'] }))).toBe(false));
  it('accepts TV series for a TV target', () => expect(matchesIpadMovieIdentity({ ...expected, type: 'tv' }, actual({ typeNames: ['电视剧'] }))).toBe(true));
  it('rejects missing target title', () => expect(matchesIpadMovieIdentity({ ...expected, titles: [] }, actual())).toBe(false));
});
