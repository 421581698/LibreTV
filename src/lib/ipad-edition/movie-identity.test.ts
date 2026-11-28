import { describe, expect, it } from 'vitest';
import { assessIpadMovieIdentity, matchesIpadMovieIdentity } from './movie-identity';

describe('iPad film identity / Spider-Man regressions', () => {
  const far = { titles: ['蜘蛛侠：英雄远征', 'Spider-Man: Far From Home'], year: '2019', type: 'movie' as const };
  const brand = { titles: ['蜘蛛侠：崭新之日', 'Spider-Man: Brand New Day'], year: '2026', type: 'movie' as const };
  const actual = (extra: Record<string, unknown> = {}) => ({
    title: 'Spider-Man: Far From Home', years: ['2019'], typeNames: ['科幻'], ...extra,
  });
  it('accepts exact English title', () => expect(matchesIpadMovieIdentity(far, actual())).toBe(true));
  it('accepts Traditional Chinese alias', () => expect(matchesIpadMovieIdentity(far, actual({ title: '蜘蛛人：離家日' }))).toBe(true));
  it('rejects Brand New Day as Far From Home', () => expect(assessIpadMovieIdentity(far, actual({ title: 'Spider-Man: Brand New Day' })).status).toBe('rejected'));
  it('rejects Homecoming', () => expect(matchesIpadMovieIdentity(far, actual({ title: '蜘蛛侠：英雄归来' }))).toBe(false));
  it('flags wrong detail year as uncertain', () => expect(assessIpadMovieIdentity(far, actual({ years: ['2026'] })).status).toBe('uncertain'));
  it('accepts detail year despite stale search-list year', () => expect(assessIpadMovieIdentity(far, actual({ years: ['2019', '2026'] })).status).toBe('verified'));
  it('does not trust a conflicting original title without a year', () => expect(assessIpadMovieIdentity({ ...far, year: '' }, actual({ originalTitle: 'Spider-Man: Brand New Day' })).status).toBe('uncertain'));
  it('allows a CMS original-title conflict corroborated by detail year', () => expect(assessIpadMovieIdentity(far, actual({ originalTitle: 'Spider-Man: Brand New Day' })).status).toBe('verified'));
  it('rejects TV series', () => expect(matchesIpadMovieIdentity(far, actual({ typeNames: ['电视剧'] }))).toBe(false));
  it('rejects short drama', () => expect(matchesIpadMovieIdentity(far, actual({ typeNames: ['短剧'] }))).toBe(false));
  it('accepts missing optional fields if the primary title matches', () => expect(matchesIpadMovieIdentity(far, actual({ years: [], typeNames: [] }))).toBe(true));
  it('parses year suffixes', () => expect(matchesIpadMovieIdentity(far, actual({ years: ['2019年', '2019-06-28'] }))).toBe(true));
  it('rejects movie for TV target', () => expect(matchesIpadMovieIdentity({ ...far, type: 'tv' }, actual({ typeNames: ['电影'] }))).toBe(false));
  it('accepts TV for TV target', () => expect(matchesIpadMovieIdentity({ ...far, type: 'tv' }, actual({ typeNames: ['电视剧'] }))).toBe(true));
  it('rejects missing expected titles', () => expect(matchesIpadMovieIdentity({ ...far, titles: [] }, actual())).toBe(false));
  it('accepts Brand New Day exact localized label with noisy original title and matching year', () =>
    expect(matchesIpadMovieIdentity(brand, {
      title: '蜘蛛侠：崭新之日', originalTitle: '蜘蛛侠4全集', years: ['2026'], typeNames: ['动作'],
    })).toBe(true));
  it('never accepts Far From Home as Brand New Day', () =>
    expect(matchesIpadMovieIdentity(brand, actual())).toBe(false));
  it('does not play contradictory Brand New Day years without confirmation', () =>
    expect(assessIpadMovieIdentity(brand, {
      title: '蜘蛛侠：崭新之日', originalTitle: 'Unrelated film', years: ['2019'],
    }).status).toBe('uncertain'));
});
