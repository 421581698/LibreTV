import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('PR #84 homepage blocking layout recovery', () => {
  const layout = read('src/app/layout.tsx');
  const recovery = read('src/app/pr84-layout-recovery.css');
  const dock = read('src/components/home/header/MobileTabBar.tsx');
  const page = read('src/app/page.tsx');
  const globalLayout = read('src/app/pr84-global-layout.css');
  const dockFix = read('src/app/pr84-dock-fix.css');
  const header = read('src/components/home/V4HomepageHeader.tsx');
  const settings = read('src/components/source-manager.tsx');

  it('loads the recovery contract after all legacy homepage and mobile overrides', () => {
    expect(layout.indexOf("import './iphone-home-inline.css';")).toBeGreaterThan(-1);
    expect(layout.indexOf("import './pr84-layout-recovery.css';")).toBeGreaterThan(
      layout.indexOf("import './iphone-home-inline.css';"),
    );
  });

  it('keeps all four navigation destinations visible in a four-column viewport dock', () => {
    expect(dock).toContain("{ href: '/', label: '首页', icon: 'home' }");
    expect(dock).toContain("{ href: '/search', label: '搜索', icon: 'search' }");
    expect(dock).toContain("{ href: '/settings', label: '设置', icon: 'settings' }");
    expect(dock).toContain("{ href: '/me', label: '我的', icon: 'user' }");
    expect(dock).toContain('createPortal(navigation, portalTarget)');
    expect(recovery).toContain('grid-template-columns: repeat(4, minmax(0, 1fr)) !important;');
    expect(dock).toContain('setPortalTarget(document.body)');
    expect(recovery).toContain('position: fixed !important;');
    expect(recovery).not.toContain('[data-homepage-dock="true"]');
    expect(recovery).toContain('position: fixed !important;');
  });

  it('mounts exactly one shared mobile navigation from the root layout', () => {
    expect(layout).toContain("import { MobileTabBar } from '@/components/home/header/MobileTabBar';");
    expect(layout).toContain('<MobileTabBar />');
    expect(header).not.toContain('<MobileTabBar />');
    expect(layout).toContain("import './pr84-global-layout.css';");
    expect(globalLayout).toContain('height: 54px !important;');
    expect(globalLayout).toContain('background: rgba(28,28,30,.70) !important;');
    expect(globalLayout).toContain('-webkit-backdrop-filter: blur(20px) saturate(150%) !important;');
    expect(globalLayout).toContain('backdrop-filter: blur(20px) saturate(150%) !important;');
    expect(globalLayout).toContain('top: -18px !important;');
    expect(globalLayout).toContain('inset: auto auto calc(8px + env(safe-area-inset-bottom, 0px)) 50% !important;');
    expect(globalLayout).not.toContain('height: 64px !important;');
    expect(globalLayout).toContain('bottom: calc(8px + env(safe-area-inset-bottom, 0px)) !important;');
    expect(globalLayout).toContain('width: 18px !important;');
    expect(globalLayout).toContain('.v4-spatial-screen[data-screen="me"] > .v4-spatial-main');
    expect(globalLayout).toContain('scroll-padding-bottom: calc(128px + env(safe-area-inset-bottom, 0px)) !important;');
  });

  it('does not repeat identical adjacent dock selectors in the dock fix stylesheet', () => {
    const lines = dockFix.split('\n').map((line) => line.trim());
    const hasDuplicateSelectorPair = lines.some(
      (line, index) =>
        line.endsWith(',') && line.slice(0, -1) === lines[index + 1],
    );
    expect(hasDuplicateSelectorPair).toBe(false);
  });

  it('protects hero artwork from the iOS status and brand area', () => {
    expect(globalLayout).toContain('position: absolute !important;');
    expect(globalLayout).toContain('inset: 0 0 auto !important;');
    expect(globalLayout).toContain('padding: calc(env(safe-area-inset-top, 0px) + 12px) 12px 0 !important;');
    expect(globalLayout).toContain('padding-top: 0 !important;');
    expect(globalLayout).toContain('height: 100% !important;');
    expect(globalLayout).toContain('object-position: center 30% !important;');
    expect(globalLayout).not.toContain('top: calc(env(safe-area-inset-top, 0px) + 54px) !important;');
  });

  it('prioritizes live hot poster rails before local watch history on the cinema lobby', () => {
    const content = read('src/components/home/V4HomepageContent.tsx');
    const hotTv = content.indexOf('id="apple-tv-top10"');
    const hotMovies = content.indexOf('id="apple-movie-top10"');
    const newReleases = content.indexOf('id="apple-new-releases"');
    const continueWatching = content.indexOf('className="v4-content-section v4-continue-section"');
    expect(hotTv).toBeGreaterThan(-1);
    expect(hotMovies).toBeGreaterThan(hotTv);
    expect(newReleases).toBeGreaterThan(hotMovies);
    expect(continueWatching).toBeGreaterThan(newReleases);
  });

  it('uses the same left-aligned Large Title hierarchy on Settings and Search', () => {
    expect(settings).toContain('<header className="settings-large-title">');
    expect(settings).toContain('<h1>设置</h1>');
    expect(globalLayout).toContain('.settings-embedded-root .settings-large-title h1');
    expect(globalLayout).toContain('.v4-search-page .v4-search-heading h1');
  });

  it('keeps the homepage and hero in natural document flow with a real scrollable page', () => {
    expect(recovery).not.toContain('overflow-y: auto !important;');
    expect(recovery).not.toContain('position: static !important;');
    expect(recovery).toContain('height: auto !important;');
    expect(recovery).toContain('flex: 0 0 auto !important;');
    expect(recovery).toContain('padding: 0 0 24px !important;');
    expect(recovery).toContain('height: clamp(360px, 55svh, 520px) !important;');
    expect(recovery).toContain('min-height: 360px !important;');
    expect(recovery).toContain('max-height: 520px !important;');
    expect(recovery).toContain('overflow: visible !important;');
    expect(page).toContain('<V4HomepageHero onPick={openRecommendation} />');
    expect(page).toContain('<V4HomepageContent onPick={openRecommendation} />');
  });

  it('uses the same body-level viewport portal on homepage and routed catalogue screens', () => {
    expect(dock).toContain('return portalTarget ? createPortal(navigation, portalTarget) : null;');
    expect(dock).not.toContain('return navigation;');
    expect(dock).not.toContain('data-homepage-dock');
    expect(globalLayout).not.toContain('data-homepage-dock');
  });
});
