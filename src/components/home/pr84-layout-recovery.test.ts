import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('PR #84 homepage blocking layout recovery', () => {
  const layout = read('src/app/layout.tsx');
  const recovery = read('src/app/pr84-layout-recovery.css');
  const dock = read('src/components/home/header/MobileTabBar.tsx');
  const page = read('src/app/page.tsx');

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

  it('does not apply the homepage body portal to routed catalogue screens', () => {
    expect(dock).toContain('return portalTarget ? createPortal(navigation, portalTarget) : null;');
    expect(dock).not.toContain('return navigation;');
    expect(dock).toContain('data-homepage-dock={isHomepage ? \'true\' : undefined}');
  });
});
