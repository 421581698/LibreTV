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
    expect(topbar).toContain('aria-label="展开侧边栏"');
    expect(topbar).toContain('aria-label="首页"');
    expect(topbar).toContain('aria-label="搜索"');
    expect(topbar).not.toContain('aria-label="电影"');
    expect(topbar).not.toContain('aria-label="电视剧"');
    expect(topbar).not.toContain('aria-label="动漫"');
    expect(topbar).not.toContain('aria-label="设置"');
    expect(topbar).not.toContain('aria-label="我的"');
    expect(shell).toContain('href="/ipad-edition/settings"');
  });

  it('keeps navigation visible on detail pages and hides it only for immersive playback', () => {
    expect(shell).toContain('const isChromeHidden = isPlayerRoute;');
    expect(shell).not.toContain('const isChromeHidden = isPlayerRoute || isDetailRoute;');
    expect(shell).toContain("data-ipad-detail={isDetailRoute ? 'true' : undefined}");
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

  it('scopes search styles to the actual nested search page element', () => {
    expect(searchPage).toContain('className="ipad-edition__page ipad-edition__search-page"');
    expect(searchPage).toContain('className="ipad-edition__search-form"');
    expect(searchCss).toContain('.ipad-edition .ipad-edition__search-page .ipad-edition__search-form');
    expect(searchCss).not.toContain('.ipad-edition.ipad-edition__search-page');
  });
});
