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
    expect(player).toContain('upsertHistory');
    expect(player).toContain('saveProgress');
    expect(player).toContain('getRestorePosition={getRestorePosition}');
    expect(player).toContain('clearProgress(item.sourceKey, item.vodId, episodeIndex)');
    expect(player).toContain('}, 8000);');
    expect(player).toContain('history?.episodeIndex === episodeIndex');
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
    expect(mobileSearch).toContain('flex: 1 1 90px !important;');
    expect(mobileSearch).not.toContain('flex: 0 0 100% !important;');
    expect(mobileSearch).toContain('.v4-header .v4-mobile-search-toggle');
    expect(mobileSearch).toContain('display: none !important;');
    expect(mobileSearch).toContain('.v4-header .v4-primary-nav');
  });
});

describe('iPhone shared navigation, routed playback and runtime cleanup', () => {
  const spatial = read('src/components/home/V4SpatialScreen.tsx');
  const friday = read('src/components/AIFloatingBall.tsx');
  const theme = read('src/app/v4-header-theme.css');
  const safeArea = read('src/app/theme-safe-area.css');
  const collectorSettings = read('src/components/source-manager.tsx');
  const collectorRoute = read('src/app/api/resource-collector/route.ts');
  const collectorValidationRoute = read('src/app/api/resource-collector/candidates/[candidateId]/validate/route.ts');
  const collectorDock = read('src/components/home/header/MobileTabBar.tsx');
  const iphoneLayout = read('src/app/iphone-glass.css');

  it('renders only the shared four-item dock on routed screens', () => {
    expect(spatial).not.toContain('MobileScreenTabs');
    expect(spatial).toContain('<V4HomepageHeader />');
  });

  it('routes catalogue posters and resource results into the shared inline player', () => {
    expect(spatial).toContain('const openRecommendation = async (movie: DoubanItem)');
    expect(spatial).toContain('onPick={openRecommendation}');
    expect(spatial).toContain('<HomeInlinePlayer item={quickPlayItem}');
    expect(spatial).not.toContain('router.push');
    expect(spatial).toContain('onClick={() => onPick(item)}');
  });

  it('releases voice capture, speech and active requests when Friday unmounts', () => {
    expect(friday).toContain('stopAllVoice();');
    expect(friday).toContain('cancelActiveRequest();');
    expect(friday).toContain('window.speechSynthesis?.cancel();');
  });

  it('exposes FMHY discovery and Scrapling media preview behind the authenticated API proxy', () => {
    expect(collectorSettings).toContain("{ id: 'collector', label: '资源采集中心'");
    expect(collectorSettings).toContain('ResourceCollectorPanel');
    expect(collectorSettings).toContain('CollectorPlayerShell');
    expect(collectorRoute).toContain('guardRequest(request)');
    expect(collectorRoute).toContain("relay('/v1/discover')");
    expect(collectorRoute).toContain("relay('/v1/crawl'");
  });
  it('keeps the four-item dock and all confirmed header utilities visible', () => {
    expect(collectorDock).toContain("href: '/me'");
    expect(iphoneLayout).not.toContain('[aria-label="观看历史"]');
    expect(iphoneLayout).toContain('v4-mobile-tabbar');
  });

  it('plays only direct media and imports a source only after CMS shape validation', () => {
    expect(collectorSettings).toContain("candidate.kind === 'direct-media'");
    expect(collectorSettings).toContain('validation.cms_shape && validation.reachable');
    expect(collectorSettings).toContain('store.addCustomApi');
    expect(collectorValidationRoute).toContain('guardRequest(request)');
    expect(collectorValidationRoute).toContain('/validate');
  });
  it('applies light-theme colors to routed iPhone screens and keeps safe-area paint below the dock', () => {
    expect(theme).toContain(':root:not(.dark) .v4-spatial-screen');
    expect(theme).toContain(':root:not(.dark) .v4-spatial-screen .v4-resource-search input');
    expect(safeArea).toContain('z-index: 1;');
    expect(safeArea).not.toContain('2147483000');
  });
});
