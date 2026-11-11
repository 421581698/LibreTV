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
    expect(dock).toContain("data-homepage-dock={isHomepage ? 'true' : undefined}");
    expect(recovery).toContain('grid-template-columns: repeat(4, minmax(0, 1fr)) !important;');
    expect(dock).toContain('setPortalTarget(document.body)');
    expect(recovery).toContain('position: fixed !important;');
    expect(recovery).toContain('position: fixed !important;');
  });

  it('mounts exactly one shared mobile navigation from the root layout', () => {
    expect(layout).toContain("import { MobileTabBar } from '@/components/home/header/MobileTabBar';");
    expect(layout).toContain('<MobileTabBar />');
    expect(header).not.toContain('<MobileTabBar />');
    expect(layout).toContain("import './pr84-global-layout.css';");
    expect(globalLayout).toContain('height: 64px !important;');
    expect(globalLayout).toContain('inset: auto auto calc(8px + env(safe-area-inset-bottom, 0px)) 50% !important;');
    expect(globalLayout).toContain('body > .v4-mobile-tabbar[data-homepage-dock="true"]');
    expect(globalLayout).toContain('height: 64px !important;');
    expect(globalLayout).toContain('bottom: calc(10px + env(safe-area-inset-bottom, 0px)) !important;');
    expect(globalLayout).toContain('width: 20px !important;');
    expect(globalLayout).toContain('.v4-spatial-screen[data-screen="me"] > .v4-spatial-main');
    expect(globalLayout).toContain('scroll-padding-bottom: calc(112px + env(safe-area-inset-bottom, 0px)) !important;');
  });

  it('protects hero artwork from the iOS status and brand area', () => {
    expect(globalLayout).toContain('position: absolute !important;');
    expect(globalLayout).toContain('inset: 0 0 auto !important;');
    expect(globalLayout).toContain('padding-top: 0 !important;');
    expect(globalLayout).toContain('height: 100% !important;');
    expect(globalLayout).toContain('object-position: center 30% !important;');
    expect(globalLayout).not.toContain('top: calc(env(safe-area-inset-top, 0px) + 54px) !important;');
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
    expect(recovery).toContain('height: clamp(500px, 68svh, 640px) !important;');
    expect(recovery).toContain('overflow: visible !important;');
    expect(page).toContain('<V4HomepageHero onPick={openRecommendation} />');
    expect(page).toContain('<V4HomepageContent onPick={openRecommendation} />');
  });

  it('uses the same body-level viewport portal on homepage and routed catalogue screens', () => {
    expect(dock).toContain('return portalTarget ? createPortal(navigation, portalTarget) : null;');
    expect(dock).not.toContain('return navigation;');
    expect(dock).toContain('data-homepage-dock={isHomepage ? \'true\' : undefined}');
  });
});
