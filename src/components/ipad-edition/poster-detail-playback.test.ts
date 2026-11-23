import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('iPad Edition poster navigation and explicit playback', () => {
  const navigation = read('src/components/ipad-edition/useIpadEditionPosterNavigation.ts');
  const searchPage = read('src/app/ipad-edition/search/page.tsx');
  const detailRoute = read('src/app/ipad-edition/detail/page.tsx');
  const tmdbSearch = read('src/app/api/tmdb/search/route.ts');
  const bangumiRoute = read('src/app/api/bangumi/subject/route.ts');
  const bangumiDetail = read('src/components/ipad-edition/BangumiSubjectDetailPage.tsx');
  const tmdbDetail = read('src/components/ipad-edition/tmdb-movie-detail-page.tsx');
  const continueWatching = read('src/components/ipad-edition/IpadEditionContinueWatching.tsx');
  const hero = read('src/components/ipad-edition/IpadEditionHero.tsx');

  it('the iPad playback drawer can always be dismissed without the auto-hidden toolbar', () => {
    const watchPage = read('src/app/watch/page.tsx');
    const playerCss = read('src/app/ipad-edition/ipad-edition.css');
    expect(watchPage).toContain('aria-label="关闭选集与换源面板"');
    expect(watchPage).toContain('aria-label="关闭播放内容面板"');
    expect(playerCss).toContain('.netflix-watch-panel-scrim');
    expect(playerCss).toContain('z-index: 95');
    expect(playerCss).toContain('z-index: 101;');
    expect(playerCss).toContain('top: calc(88px + env(safe-area-inset-top, 0px)) !important');
  });

  it('CMS search poster taps open the detail page before the player', () => {
    expect(searchPage).toContain("router.push('/ipad-edition/detail?' + next.toString())");
    expect(searchPage).toContain("next.set('sourceUrl', item.sourceUrl)");
    expect(searchPage).toContain("next.set('sourceName'");
    expect(searchPage).not.toContain("router.push('/ipad-edition/watch?'");
  });

  it('poster navigation only routes to metadata details and never searches CMS sources', () => {
    expect(navigation).not.toContain('api.search');
    expect(navigation).toContain("router.push('/ipad-edition/detail?' + params.toString())");
    expect(navigation).toContain("params.set('tmdbId', movie.id)");
    expect(navigation).toContain("params.set('bangumiId', movie.id)");
    expect(detailRoute).toContain('<TmdbMovieDetailPage');
    expect(detailRoute).toContain('<BangumiSubjectDetailPage');
  });

  it('TMDB regional search results retain their provider identity for direct detail routing', () => {
    expect(tmdbSearch).toContain("provider: 'tmdb'");
    expect(navigation).toContain("provider === 'tmdb' && /^\\d{1,12}$/.test(movie.id)");
  });

  it('Bangumi posters load subject metadata before any CMS search', () => {
    expect(bangumiRoute).toContain('https://api.bgm.tv/v0/subjects/');
    expect(bangumiDetail).toContain("fetch('/api/bangumi/subject?'");
    const startIndex = bangumiDetail.indexOf('const startPlayback = async () => {');
    expect(bangumiDetail.slice(0, startIndex)).not.toContain('api.search(');
    expect(bangumiDetail.slice(startIndex)).toContain('api.search(title, sources, yellowFilter)');
  });

  it('both TMDB and Bangumi detail pages search only after the Start Playback button is tapped', () => {
    const tmdbStart = tmdbDetail.indexOf('const startPlayback = async () => {');
    expect(tmdbDetail.slice(0, tmdbStart)).not.toContain('api.search(');
    expect(tmdbDetail.slice(tmdbStart)).toContain('api.search(term, sources, yellowFilter)');
    expect(tmdbDetail).toContain('▶ 开始播放');
    expect(bangumiDetail).toContain('▶ 开始播放');
    expect(hero).toContain('查看详情');
  });

  it('continue-watching cards jump directly to the player and preserve resume context', () => {
    expect(continueWatching).toContain('buildContinueWatchingUrl(item)');
    expect(continueWatching).toContain('className="ipad-edition__continue-card"');
    const resumeUrl = read('src/lib/continue-watching-url.ts');
    expect(resumeUrl).toContain("return '/ipad-edition/watch?' + params.toString()");
    expect(resumeUrl).toContain("params.set('position'");
    expect(resumeUrl).toContain("index: String(Math.max(0, item.episodeIndex))");
    const watchPage = read('src/app/watch/page.tsx');
    expect(watchPage).toContain("searchParams.get('position')");
    expect(watchPage).toContain('if (urlPos > 0) return urlPos');
  });
});
