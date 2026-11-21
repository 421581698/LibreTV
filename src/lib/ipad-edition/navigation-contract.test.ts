import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(
  resolve(process.cwd(), 'src/components/ipad-edition/IpadEditionShell.tsx'),
  'utf8',
);

describe('iPad Edition navigation contract', () => {
  it('keeps all primary destinations directly available in the persistent capsule', () => {
    for (const destination of [
      'href="/ipad-edition"',
      'href="/ipad-edition/movies"',
      'href="/ipad-edition/series"',
      'href="/ipad-edition/anime"',
      'href="/ipad-edition/search"',
      'href="/ipad-edition/library"',
      'href="/ipad-edition/settings"',
    ]) {
      expect(shell).toContain(destination);
    }
  });

  it('keeps navigation visible on detail pages and hides it only for immersive playback', () => {
    expect(shell).toContain('const isChromeHidden = isPlayerRoute;');
    expect(shell).not.toContain('const isChromeHidden = isPlayerRoute || isDetailRoute;');
    expect(shell).toContain('data-ipad-detail={isDetailRoute ? \'true\' : undefined}');
  });

  it('preserves a keyboard and touch accessible sidebar toggle', () => {
    expect(shell).toContain('aria-expanded={sidebarOpen}');
    expect(shell).toContain('aria-controls="ipad-edition-sidebar"');
    expect(shell).toContain('onClick={() => setSidebarOpen((open) => !open)}');
    expect(shell).toContain('onClick={() => setSidebarOpen(false)}');
    expect(shell).toContain("if (event.key === 'Escape') setSidebarOpen(false);");
  });
});
