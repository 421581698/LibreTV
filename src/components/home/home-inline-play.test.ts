import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('iPhone homepage inline playback and top search', () => {
  const home = read('src/app/page.tsx');
  const player = read('src/components/home/HomeInlinePlayer.tsx');
  const mobileSearch = read('src/app/iphone-home-inline.css');
  const featuredHero = read('src/components/home/V4HomepageHero.tsx');

  it('homepage recommendation posters open the inline player instead of the detail route', () => {
    expect(home).toContain('setQuickPlayItem(matched)');
    expect(featuredHero).toContain('aria-label={`立即播放：${slide.title}`}');
    expect(featuredHero).toContain('onClick={() => onPick(slide)}');
    expect(home).toContain('onOpen={(item) => setQuickPlayItem(item)}');
    expect(home).toContain('<HomeInlinePlayer item={quickPlayItem}');
    expect(player).toContain("import('@/components/player-shell')");
    expect(player).toContain('api.detail(item.vodId, source, controller.signal)');
    expect(player).toContain('<PlayerShell');
    expect(player).not.toContain('useRouter');
    expect(player).not.toContain('router.push');
  });

  it('inline player aborts pending detail requests and supports closing without route navigation', () => {
    expect(player).toContain('const controller = new AbortController()');
    expect(player).toContain('return () => controller.abort()');
    expect(player).toContain('onCloseRef.current()');
    expect(player).toContain('aria-modal="true"');
    expect(player).toContain('onNextEpisode');
  });

  it('iPhone shows an editable search field in the header row and hides the collapsed search toggle', () => {
    expect(mobileSearch).toContain('.v4-header .v4-header-actions {');
    expect(mobileSearch).toContain('display: contents !important;');
    expect(mobileSearch).toContain('display: flex !important;');
    expect(mobileSearch).toContain('width: 100% !important;');
    expect(mobileSearch).toContain('.v4-header .v4-mobile-search-toggle');
    expect(mobileSearch).toContain('display: none !important;');
    expect(mobileSearch).toContain('.v4-header .v4-primary-nav');
  });
});
