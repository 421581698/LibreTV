import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(
  resolve(process.cwd(), 'src/components/ipad-edition/IpadEditionShell.tsx'),
  'utf8',
);
const responsiveStyles = readFileSync(
  resolve(process.cwd(), 'src/app/ipad-edition/responsive-system.css'),
  'utf8',
);
const searchPage = readFileSync(
  resolve(process.cwd(), 'src/app/ipad-edition/search/page.tsx'),
  'utf8',
);
const searchCss = readFileSync(
  resolve(process.cwd(), 'src/app/ipad-edition/search/search.css'),
  'utf8',
);

describe('iPad Edition navigation contract', () => {
  it('limits the floating top capsule to sidebar, home, search and my icons', () => {
    const topbarStart = shell.indexOf('<header className="ipad-nav__topbar">');
    const topbarEnd = shell.indexOf('</header>', topbarStart);
    const topbar = topbarStart >= 0 && topbarEnd > topbarStart
      ? shell.slice(topbarStart, topbarEnd)
      : '';
    expect(topbar).toContain("aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}");
    expect(topbar).toContain('aria-label="首页"');
    expect(topbar).toContain('href="/ipad-edition"');
    expect(topbar).toContain('aria-label="搜索"');
    expect(topbar).toContain('aria-label="我的"');
    expect(topbar).not.toContain('aria-label="电影"');
    expect(topbar).not.toContain('aria-label="剧集"');
    expect(topbar).not.toContain('aria-label="动漫"');
    expect(topbar).not.toContain('ipad-nav__label');
    expect((topbar.match(/<button\b/g) ?? []).length).toBe(1);
    expect((topbar.match(/<Link\b/g) ?? []).length).toBe(3);
    expect(shell).toContain("href: '/ipad-edition/settings'");
  });

  it('keeps navigation visible on detail pages and hides it only for immersive playback', () => {
    expect(shell).toContain('const isChromeHidden = isPlayerRoute;');
    expect(shell).not.toContain('const isChromeHidden = isPlayerRoute || isDetailRoute;');
    expect(shell).toContain("data-ipad-detail={isDetailRoute ? 'true' : undefined}");
  });

  it('sizes the icon-only top capsule to its content while respecting the iPad viewport', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/ipad-edition.css'), 'utf8');
    expect(styles).toContain('width: max-content !important;');
    expect(styles).toContain('max-width: calc(100vw - 32px);');
    expect(styles).toContain('height: 52px;');
    expect(styles).toContain('flex: 0 0 auto;');
  });


  it('keeps the cinema hero full-bleed while recommendation rails retain their own page gutter', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/hero.css'), 'utf8');
    const layout = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/ipad-edition.css'), 'utf8');
    expect(styles).toContain('width: 100vw;');
    expect(styles).toContain('margin: 0;');
    expect(styles).toContain('border-radius: 0;');
    expect(layout).toContain('.ipad-edition__today, .ipad-edition__rail-section');
    expect(layout).toContain('padding-left: var(--ipad-page-gutter) !important;');
    expect(layout).toContain('padding-right: var(--ipad-page-gutter) !important;');
    expect(layout).toContain('.ipad-edition[data-ipad-home="true"] {');
    expect(layout).toContain('padding-inline: 0;');
    expect(layout).toContain('padding-block-start: 0;');
  });

  it('reserves space below the floating capsule and keeps poster captions in the rail flow', () => {
    const layout = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/ipad-edition.css'), 'utf8');
    expect(layout).toContain('padding-block-start: 0;');
    expect(layout).toContain('padding: 0 clamp(16px, 2.4vw, 36px) 56px !important;');
    expect(layout).toContain('padding: 0 0 40px !important;');
    expect(layout).toContain('.ipad-edition .ipad-edition__poster-grid,');
    expect(layout).toContain('height: auto;');
    expect(layout).toContain('.ipad-edition .ipad-edition__poster-card {');
    expect(layout).toContain('grid-template-rows: auto auto auto;');
    expect(layout).toContain('background: #f5f5f7;');
  });

  it('centers transparent hero pagination dots below the featured content', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/hero.css'), 'utf8');
    expect(styles).toContain('.ipad-edition[data-ipad-home="true"] .ipad-edition__cinema-hero-pagination');
    expect(styles).toContain('left: 50%;');
    expect(styles).toContain('background: transparent;');
    expect(styles).toContain('transform: translateX(-50%);');
  });

  it('switches navigation by app width and keeps expanded links keyboard reachable', () => {
    expect(shell).toContain('resolveIpadNavigationLayout(root.getBoundingClientRect().width)');
    expect(shell).toContain('tabIndex={sidebarOpen ? 0 : -1}');
    expect(shell).toContain('inert={!sidebarOpen}');
    expect(shell).toContain('aria-hidden={!sidebarOpen}');
    expect(responsiveStyles).toContain('width: calc(100% - var(--ipad-sidebar-width))');
    expect(responsiveStyles).toContain('container-type: inline-size');
  });

  it('starts with the wide sidebar collapsed and always exposes a clear close control', () => {
    expect(shell).toContain('const [sidebarOpen, setSidebarOpen] = useState(false);');
    expect(shell).toContain('aria-label="关闭侧边栏"');
    expect(shell).toContain('title="收起侧边栏"');
    expect(shell).toContain('aria-label="收起侧边栏"');
    expect(shell).toContain('className="ipad-nav__collapse-button"');
    expect(shell).toContain('setSidebarOpen((open) => !open)');
    expect(responsiveStyles).toContain('visibility: hidden !important; transform: translateX(-110%) !important; pointer-events: none !important;');
    expect(responsiveStyles).toContain('width: 100% !important; margin: 0 !important;');
    expect(shell).not.toContain('beginSidebarGesture');
    expect(shell).not.toContain('ipad-nav__edge-swipe-zone');
    expect(shell).toContain('setSidebarOpen(false);');
    expect(shell).toContain('setSidebarOpen(false);');
  });

  it('starts the sidebar closed at every width and keeps a visible close path when opened', () => {
    expect(shell).toContain('const [sidebarOpen, setSidebarOpen] = useState(false);');
    expect(shell).toContain('data-ipad-layout={wideLayout ? \'expanded\' : \'compact\'}');
    expect(shell).toContain('aria-label="关闭侧边栏"');
    expect(shell).toContain('title="收起侧边栏"');
    expect(shell).toContain('aria-label="收起侧边栏"');
    expect(shell).toContain('setSidebarOpen(false);');
    expect(responsiveStyles).toContain('[data-ipad-sidebar-open="false"] .ipad-nav__sidebar');
    expect(responsiveStyles).toContain('[data-ipad-sidebar-open="true"] > .ipad-edition__main');
  });

  it('closes wide navigation after route changes and reports its expanded state accessibly', () => {
    expect(shell).toContain('setSidebarOpen(false);');
    expect(shell).toContain('}, [pathname, wideLayout]);');
    expect(shell).toContain('aria-expanded={sidebarOpen}');
  });

  it('preserves an accessible sidebar toggle and manages modal focus/scroll lifecycle', () => {
    expect(shell).toContain('aria-expanded={sidebarOpen}');
    expect(shell).toContain('aria-controls="ipad-edition-sidebar"');
    expect(shell).toContain('setSidebarOpen((open) => !open)');
    expect(shell).toContain('setSidebarOpen((open) => !open)');
    expect(shell).toContain('new ResizeObserver(updateLayout)');
    expect(shell).toContain('data-ipad-layout={wideLayout ? \'expanded\' : \'compact\'}');
    expect(shell).toContain('onClick={() => setSidebarOpen(false)}');
    expect(shell).toContain("if (event.key === 'Escape')");
    expect(shell).toContain("if (event.key !== 'Tab') return;");
    expect(shell).toContain("document.body.style.overflow = 'hidden';");
    expect(shell).toContain('focusable()[0]?.focus({ preventScroll: true });');
    expect(shell).toContain('last.focus();');
    expect(shell).toContain('first.focus();');
    expect(shell).toContain('menuButtonRef.current?.focus({ preventScroll: true });');
  });

  it('opens a selected search result in details before playback', () => {
    expect(searchPage).toContain("router.push('/ipad-edition/detail?' + next.toString());");
    expect(searchPage).not.toContain("router.push('/ipad-edition/watch?'");
    expect(searchPage).toContain('sourceName: item.sourceName || item.sourceKey');
    expect(searchPage).toContain("if (item.sourceUrl) next.set('sourceUrl', item.sourceUrl);");
  });

  it('scopes search styles to the actual nested search page element', () => {
    expect(searchPage).toContain('className="ipad-edition__page ipad-edition__search-page"');
    expect(searchPage).toContain('className="ipad-edition__search-form"');
    expect(searchCss).toContain('.ipad-edition .ipad-edition__search-page .ipad-edition__search-form');
    expect(searchCss).not.toContain('.ipad-edition.ipad-edition__search-page');
  });
});


describe('iPad Edition Cinema Experience', () => {
  it('supports touch swipes, keyboard navigation and explicit previous/next controls', () => {
    const hero = readFileSync(resolve(process.cwd(), 'src/components/ipad-edition/IpadEditionHero.tsx'), 'utf8');



    expect(hero).toContain('onPointerDown={handlePointerDown}');
    expect(hero).toContain('onPointerUp={handlePointerUp}');
    expect(hero).toContain("event.key === 'ArrowLeft'");
    expect(hero).toContain("event.key === 'ArrowRight'");
    expect(hero).toContain('aria-label="上一部精选影片"');
    expect(hero).toContain('aria-label="下一部精选影片"');
    expect(hero).toContain('aria-roledescription="电影精选轮播"');
  });

  it('keeps cinematic transitions restrained and respects reduced-motion preferences', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/hero.css'), 'utf8');
    expect(styles).toContain('touch-action: pan-y pinch-zoom;');
    expect(styles).toContain('@keyframes ipad-cinema-copy-in');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('animation: none !important;');
  });
});


describe('iPad Edition cinematic detail experience', () => {
  it('loads the isolated detail presentation without changing shared movie detail behavior', () => {
    const detailRoute = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/detail/page.tsx'), 'utf8');
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/detail/detail.css'), 'utf8');
    expect(detailRoute).toContain("import './detail.css';");
    expect(detailRoute).toContain('<MovieDetailPage watchPath="/ipad-edition/watch" />');
    expect(styles).toContain('.ipad-edition [data-ipad-detail="true"] .movie-detail-hero');
    expect(styles).toContain('.ipad-edition [data-ipad-detail="true"] .movie-detail-title');
    expect(styles).toContain('.ipad-edition [data-ipad-detail="true"] .movie-episode-card');
    expect(styles).toContain('env(safe-area-inset-top, 0px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('@media (prefers-reduced-transparency: reduce)');
  });
});


describe('iPad Edition end-to-end cinema navigation contracts', () => {
  it('opens recommendation posters directly to metadata details without searching CMS sources', () => {
    const posterNavigation = readFileSync(resolve(process.cwd(), 'src/components/ipad-edition/useIpadEditionPosterNavigation.ts'), 'utf8');
    const home = readFileSync(resolve(process.cwd(), 'src/components/ipad-edition/IpadEditionHome.tsx'), 'utf8');
    const collection = readFileSync(resolve(process.cwd(), 'src/components/ipad-edition/IpadEditionCollection.tsx'), 'utf8');
    const hero = readFileSync(resolve(process.cwd(), 'src/components/ipad-edition/IpadEditionHero.tsx'), 'utf8');
    const detailRoute = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/detail/page.tsx'), 'utf8');
    const tmdbDetail = readFileSync(resolve(process.cwd(), 'src/components/ipad-edition/tmdb-movie-detail-page.tsx'), 'utf8');
    const bangumiDetail = readFileSync(resolve(process.cwd(), 'src/components/ipad-edition/BangumiSubjectDetailPage.tsx'), 'utf8');

    expect(home).toContain('<PosterRenderer variant="poster"');
    expect(home).toContain('url={item.cover}');
    expect(home).toContain('onClick={() => void openPoster(item)}');
    expect(collection).toContain('<PosterRenderer variant="poster"');
    expect(collection).toContain('onClick={() => void openPoster(item)}');
    expect(hero).toContain('onClick={() => onOpen(item)}');
    expect(hero).toContain('查看详情');
    expect(posterNavigation).not.toContain('api.search');
    expect(posterNavigation).toContain("provider === 'tmdb'");
    expect(posterNavigation).toContain("params.set('tmdbId', movie.id)");
    expect(posterNavigation).toContain("params.set('bangumiId', movie.id)");
    expect(posterNavigation).toContain("router.push('/ipad-edition/detail?' + params.toString())");
    expect(posterNavigation).not.toContain("router.push('/ipad-edition/search?q='");
    expect(detailRoute).toContain('<TmdbMovieDetailPage');
    expect(detailRoute).toContain('<BangumiSubjectDetailPage');
    expect(tmdbDetail).toContain('const startPlayback = async () => {');
    expect(tmdbDetail).toContain('findVerifiedIpadResource({');
    const coordinator = readFileSync(resolve(process.cwd(), 'src/lib/ipad-edition/playback-coordinator.ts'), 'utf8');
    expect(coordinator).toContain('api.search(term, usableSources, yellowFilter, { signal })');
    expect(tmdbDetail).toContain('▶ 开始播放');
    expect(bangumiDetail).toContain('const startPlayback = async () => {');
    expect(bangumiDetail).toContain('api.search(title, sources, yellowFilter, { signal: controller.signal })');
    expect(bangumiDetail).toContain('▶ 开始播放');
    expect(tmdbDetail.slice(0, tmdbDetail.indexOf('const startPlayback'))).not.toContain('api.search(');
    expect(bangumiDetail.slice(0, bangumiDetail.indexOf('const startPlayback'))).not.toContain('api.search(');
  });

  it('activates the dedicated detail styling on the actual detail route', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/detail/page.tsx'), 'utf8');
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/detail/detail.css'), 'utf8');
    expect(route).toContain('data-ipad-detail="true"');
    expect(styles).toContain('.ipad-edition [data-ipad-detail="true"] .movie-detail-hero');
    expect(styles).toContain('.ipad-edition [data-ipad-detail="true"] .movie-detail-title');
  });

  it('renders homepage content as touch-scrollable cinematic shelves', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/ipad-edition.css'), 'utf8');
    expect(styles).toContain('scroll-snap-type: x mandatory;');
    expect(styles).toContain('-webkit-overflow-scrolling: touch;');
    expect(styles).toContain('.ipad-edition__home .ipad-edition__poster-card');
    expect(styles).toContain('padding-block-start: 0;');
  });
});


describe('iPad Edition state regression contracts', () => {
  it('synchronizes search when browser history changes the URL and aborts stale requests on unmount', () => {
    expect(searchPage).toContain('}, [initial]);');
    expect(searchPage).toContain('useEffect(() => () => activeController.current?.abort(), []);');
    expect(searchPage).toContain("router.replace('/ipad-edition/search?' + new URLSearchParams({ q: value }).toString(), { scroll: false });");
  });

  it('does not lock body scroll for hidden navigation on the immersive player route', () => {
    expect(shell).toContain('if (isChromeHidden || !sidebarOpen) return;');
    expect(shell).toContain('[sidebarOpen, isChromeHidden]');
  });
});


describe('iPad Edition regional release merge regression', () => {
  it('preserves both-region labeling even when US and CN dates differ', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ipad-edition/IpadEditionHome.tsx'), 'utf8');
    expect(source).toContain("const combinedRegion = existing.releaseRegion === item.releaseRegion");
    expect(source).toContain("byId.set(item.id, { ...preferred, releaseRegion: combinedRegion });");
  });
});
