import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(
  resolve(process.cwd(), 'src/components/ipad-edition/IpadEditionShell.tsx'),
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
  it('keeps exactly the three agreed actions in the persistent top capsule', () => {
    const topbarStart = shell.indexOf('<header className="ipad-nav__topbar">');
    const topbarEnd = shell.indexOf('</header>', topbarStart);
    const topbar = topbarStart >= 0 && topbarEnd > topbarStart
      ? shell.slice(topbarStart, topbarEnd)
      : '';
    expect(topbar).toContain("aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}");
    expect(topbar).toContain('aria-label="首页"');
    expect(topbar).toContain('aria-label="搜索"');
    expect(topbar).not.toContain('aria-label="电影"');
    expect(topbar).not.toContain('aria-label="电视剧"');
    expect(topbar).not.toContain('aria-label="动漫"');
    expect(topbar).not.toContain('aria-label="设置"');
    expect(topbar).not.toContain('aria-label="我的"');
    expect(shell).toContain("href: '/ipad-edition/settings'");
  });

  it('keeps navigation visible on detail pages and hides it only for immersive playback', () => {
    expect(shell).toContain('const isChromeHidden = isPlayerRoute;');
    expect(shell).not.toContain('const isChromeHidden = isPlayerRoute || isDetailRoute;');
    expect(shell).toContain("data-ipad-detail={isDetailRoute ? 'true' : undefined}");
  });

  it('sizes the top capsule to its three actions instead of a fixed oversized width', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/ipad-edition.css'), 'utf8');
    expect(styles).toContain('width: max-content !important;');
    expect(styles).toContain('height: 48px !important;');
    expect(styles).toContain('flex: 0 0 36px !important;');
  });


  it('keeps the homepage hero and recommendation rails on one shared gutter', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/hero.css'), 'utf8');
    const layout = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/ipad-edition.css'), 'utf8');
    expect(styles).toContain('width: calc(100% + 2 * clamp(16px, 2.4vw, 36px));');
    expect(styles).toContain('margin-inline: calc(-1 * clamp(16px, 2.4vw, 36px));');
    expect(styles).toContain('border-radius: 0;');
    expect(layout).toContain('.ipad-edition .ipad-edition__today,');
    expect(layout).toContain('padding-inline: var(--ipad-page-gutter);');
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

  it('places hero pagination in the left-side safe area away from the poster artwork', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/app/ipad-edition/hero.css'), 'utf8');
    expect(styles).toContain('left: clamp(22px, 4vw, 56px);');
    expect(styles).toContain('right: auto;');
  });

  it('preserves an accessible sidebar toggle and manages modal focus/scroll lifecycle', () => {
    expect(shell).toContain('aria-expanded={sidebarOpen}');
    expect(shell).toContain('aria-controls="ipad-edition-sidebar"');
    expect(shell).toContain('onClick={() => setSidebarOpen((open) => !open)}');
    expect(shell).toContain('onClick={() => setSidebarOpen(false)}');
    expect(shell).toContain("if (event.key === 'Escape')");
    expect(shell).toContain("if (event.key !== 'Tab') return;");
    expect(shell).toContain("document.body.style.overflow = 'hidden';");
    expect(shell).toContain('focusable()[0]?.focus({ preventScroll: true });');
    expect(shell).toContain('last.focus();');
    expect(shell).toContain('first.focus();');
    expect(shell).toContain('menuButtonRef.current?.focus({ preventScroll: true });');
  });

  it('opens a selected search result directly in the playback route', () => {
    expect(searchPage).toContain("router.push('/ipad-edition/watch?' + next.toString());");
    expect(searchPage).not.toContain("router.push('/ipad-edition/detail?' + next.toString());");
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
    expect(styles).toContain('.ipad-edition[data-ipad-detail="true"] .movie-episode-card');
    expect(styles).toContain('env(safe-area-inset-top, 0px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('@media (prefers-reduced-transparency: reduce)');
  });
});


describe('iPad Edition end-to-end cinema navigation contracts', () => {
  it('sends recommendation-only hero items to search instead of an incomplete detail route', () => {
    const hero = readFileSync(resolve(process.cwd(), 'src/components/ipad-edition/IpadEditionHero.tsx'), 'utf8');
    expect(hero).toContain("return '/ipad-edition/search?q=' + encodeURIComponent(title);");
    expect(hero).toContain('查找播放资源');
    expect(hero).not.toContain("return '/ipad-edition/detail?title='");
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
