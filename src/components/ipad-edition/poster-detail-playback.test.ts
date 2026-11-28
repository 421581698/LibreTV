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
    expect(playerCss).toContain('z-index: 60;');
    expect(playerCss).toContain('z-index: 101;');
    expect(playerCss).toContain('top: calc(88px + env(safe-area-inset-top, 0px)) !important');
  });

  it('CMS search poster taps open the detail page before the player', () => {
    expect(searchPage).toContain("router.push('/ipad-edition/detail?' + next.toString())");
    expect(searchPage).toContain("next.set('sourceUrl', item.sourceUrl)");
    expect(searchPage).toContain('sourceName: item.sourceName || item.sourceKey');
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
    expect(bangumiDetail.slice(startIndex)).toContain('api.search(title, sources, yellowFilter, { signal: controller.signal })');
  });

  it('both TMDB and Bangumi detail pages search only after the Start Playback button is tapped', () => {
    const tmdbStart = tmdbDetail.indexOf('const startPlayback = async () => {');
    expect(tmdbDetail.slice(0, tmdbStart)).not.toContain('api.search(');
    expect(tmdbDetail.slice(tmdbStart)).toContain('findVerifiedIpadResource({');
    expect(read('src/lib/ipad-edition/playback-coordinator.ts')).toContain('api.search(term, usableSources, yellowFilter, { signal })');
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
    expect(watchPage).toContain('if (Number.isFinite(urlPos) && urlPos > 0) return urlPos');
  });
});


describe('source switching preserves the active player edition', () => {
  it('keeps iPad source switches on the cinema route and ordinary switches on the ordinary route', () => {
    const modal = read('src/components/switch-source.tsx');
    expect(modal).toContain('const pathname = usePathname();');
    expect(modal).toContain("const targetUrl = pathname === '/ipad-edition/watch'");
    expect(modal).toContain('? `/ipad-edition${watchUrl}`');
    expect(modal).toContain(': watchUrl;');
    expect(modal).toContain('router.push(position > 5 ? `${targetUrl}&position=${Math.floor(position)}` : targetUrl);');
    expect(modal).toContain('targetIndex === currentIndex ? getCurrentPosition?.() ?? 0 : 0');
  });
});


describe('Cinema player lifecycle', () => {
  it('keeps the healthy iPad player boundary stable across media URLs', () => {
    const watch = read('src/app/watch/page.tsx');
    expect(watch).toContain('key={isIpadEditionPlayback ? "ipad-cinema" : playerUrl} resetKey={cinemaMediaGate.media.url}');
    expect(watch).toContain('<NativeCinemaFallback key={cinemaMediaGate.media.url}');
    const boundary = read('src/components/playback-error-boundary.tsx');
    expect(boundary).toContain('this.state.failed && previousProps.resetKey !== this.props.resetKey');
  });
});

describe('Cinema V4 and ordinary watch UI isolation', () => {
  it('keeps legacy chrome out of the Cinema React render tree', () => {
    const watch = read('src/app/watch/page.tsx');
    const cinema = read('src/components/ipad-edition/CinemaPlaybackActions.tsx');
    const classic = read('src/components/watch/ClassicWatchControls.tsx');
    const css = read('src/app/ipad-edition/cinema-v4.css');
    const ipadRoute = read('src/app/ipad-edition/watch/page.tsx');
    expect(ipadRoute).toContain('<PlaybackEditionProvider edition="cinema-v4">');
    expect(watch).toContain("usePlaybackEdition() === 'cinema-v4'");
    expect(watch).not.toContain("pathname === '/ipad-edition/watch'");
    expect(watch).toContain('isIpadEditionPlayback && <CinemaPlaybackActions');
    expect(watch).toContain('!isIpadEditionPlayback && <ClassicWatchTools');
    expect(watch).toContain('!isIpadEditionPlayback && <ClassicWatchTitle');
    expect(watch).toContain('!isIpadEditionPlayback && <ClassicWatchRateButton');
    expect(watch).not.toContain('className="netflix-watch-tools"');
    expect(watch).not.toContain('className="watch-cinema-rate"');
    expect(watch).not.toContain('className="cinema-v4-actions"');
    expect(classic).toContain('className="netflix-watch-tools"');
    expect(cinema).toContain('className="cinema-v4-actions"');
    expect(cinema).toContain('cinema-v4-touch-shield');
    expect(css).not.toContain('.ipad-edition-watch .netflix-title-row');
    expect(css).not.toContain('.ipad-edition-watch .netflix-watch-tools');
  });

  it('retains download, skip segments and auto-next in the Cinema details drawer', () => {
    const watch = read('src/app/watch/page.tsx');
    expect(watch).toContain('onClick={downloadCurrentEpisode}>下载本集');
    expect(watch).toContain('跳过片段标记');
    expect(watch).toContain('自动播放下一集');
    expect(watch).toContain('setSkipPanelOpen(true)');
    expect(watch).toContain('store.updateSettings({ autoplayNext: event.target.checked })');
    expect(watch).toContain('selectCinemaPlaybackMedia({');
    expect(watch).toContain('cinemaMediaGate.showPlayer');
  });
  it('offers source switching when the Cinema playback engine reports an error', () => {
    const player = read('src/components/player-shell.tsx');
    const watch = read('src/app/watch/page.tsx');
    expect(player).toContain('cinemaMode && onRequestSwitchSource');
    expect(player).toContain("onRequestSwitchSource('playback-error')");
    expect(player).toContain('更换播放源');
    expect(watch).toContain('onRequestSwitchSource={() => {');
    expect(watch).toContain('setSwitchOpen(true)');
  });

});

describe('Cinema audio track access', () => {
  it('exposes HLS track selection inside the Cinema Dolby sheet without classic controls', () => {
    const player = read('src/components/player-shell.tsx');
    expect(player).toContain('data-testid="cinema-audio-track-controls"');
    expect(player).toContain('audioTrackOptions.length > 1');
    expect(player).toContain('renderAudioTrackOptions()');
    expect(player).toContain('selectHlsAudioTrack(hls, track.id)');
    expect(player).toContain('audioTrackOptions.length > 1 && !cinemaMode');
  });
});
