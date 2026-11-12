import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('iPhone homepage detail navigation and top search', () => {
  const home = read('src/app/page.tsx');
  const player = read('src/components/home/HomeInlinePlayer.tsx');
  const mobileSearch = read('src/app/iphone-home-inline.css');
  const featuredHero = read('src/components/home/V4HomepageHero.tsx');

  it('homepage recommendation posters open the dedicated detail route before playback', () => {
    expect(home).toContain('const rankedMatches = rankMovieCandidatesByQuality(');
    expect(home).toContain('openDetail(rankedMatches[0]);');
    expect(featuredHero).toContain('aria-label={`查看详情：${slide.title}`}');
    expect(featuredHero).toContain('onClick={() => onPick(slide)}');
    expect(home).toContain('onOpen={openDetail}');
    expect(home).toContain("router.push('/detail?' + params.toString())");
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
    expect(player).toContain('const visibleDetail = requestKey && detailKey === requestKey ? detail : null;');
    expect(player).toContain('detailKey !== requestKey');
    expect(player).toContain('setDetailKey(currentRequestKey)');
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
  const fridayFab = read('src/components/friday/useFridayFabController.ts');
  const homepageHeader = read('src/components/home/V4HomepageHeader.tsx');
  const searchModule = read('src/components/home/header/SearchModule.tsx');
  const theme = read('src/app/v4-header-theme.css');
  const safeArea = read('src/app/theme-safe-area.css');
  const collectorSettings = read('src/components/source-manager.tsx');
  const collectorWorkflow = read('src/lib/resource-collector-workflow.ts');
  const collectorRoute = read('src/app/api/resource-collector/route.ts');
  const collectorValidationRoute = read('src/app/api/resource-collector/candidates/[candidateId]/validate/route.ts');
  const collectorDock = read('src/components/home/header/MobileTabBar.tsx');
  const iphoneLayout = read('src/app/iphone-glass.css');
  const mobileSearch = read('src/app/iphone-home-inline.css');

  it('renders only the shared four-item dock on routed screens', () => {
    expect(spatial).not.toContain('MobileScreenTabs');
    expect(spatial).toContain('<V4HomepageHeader />');
  });

  it('routes catalogue posters, resource results and personal library entries into the detail center', () => {
    expect(spatial).toContain('const openRecommendation = async (movie: DoubanItem)');
    expect(spatial).toContain('onPick={openRecommendation}');
    expect(spatial).toContain('onPick={openDetail}');
    expect(spatial).toContain("router.push('/detail?' + params.toString())");
    expect(spatial).toContain("const href = '/detail?' + params.toString()");
    expect(spatial).toContain('onClick={() => onPick(item)}');
  });

  it('releases voice capture, speech and active requests when Friday unmounts', () => {
    expect(friday).toContain('stopAllVoice();');
    expect(friday).toContain('cancelActiveRequest();');
    expect(friday).toContain('window.speechSynthesis?.cancel();');
  });

  it('wires the homepage Friday orb tap to the existing synchronous voice start path', () => {
    expect(homepageHeader).toContain('<AIFloatingBall showFab inlineMode={false}/>');
    expect(friday).toContain('onOpen: openAndListen');
    expect(friday).toContain('onClick={handleFabClick}');
    expect(friday).toContain('const openAndListen = useCallback(() => {');
    expect(friday).toContain('startListening(false);');
    expect(fridayFab).toContain('window.addEventListener("pointerup", onPointerUp, true)');
    expect(fridayFab).toContain('onOpen();');
  });

  it('keeps the iPhone header search accessible and the orb tap independent of pointer capture', () => {
    expect(searchModule).toContain('aria-label="搜索电影、电视剧"');
    expect(searchModule).toContain('onSubmit');
    expect(mobileSearch).toContain('min-width: 84px !important;');
    expect(mobileSearch).toContain('.v4-header .v4-primary-nav');
    expect(fridayFab).not.toContain('setPointerCapture');
    expect(fridayFab).toContain('A tap opens the assistant from the click event');
  });

  it('exposes FMHY discovery and Scrapling media preview behind the authenticated API proxy', () => {
    expect(collectorSettings).toContain("{ id: 'collector', label: '资源采集中心'");
    expect(collectorSettings).toContain('ResourceCollectorPanel');
    expect(collectorSettings).toContain('CollectorPlayerShell');
    expect(collectorRoute).toContain('guardPrivateFeatureRequest(request)');
    expect(collectorRoute).toContain("action === 'tasks' ? '/v1/tasks' : '/v1/discover'");
    expect(collectorRoute).toContain("collectorRequest('/v1/crawl'");
  });
  it('keeps the four-item dock and all confirmed header utilities visible', () => {
    expect(collectorDock).toContain("href: '/me'");
    expect(iphoneLayout).not.toContain('[aria-label="观看历史"]');
    expect(iphoneLayout).toContain('v4-mobile-tabbar');
  });

  it('plays only direct media and imports a source only after CMS shape validation', () => {
    expect(collectorSettings).toContain('isCandidatePreviewEligible({');
    expect(collectorSettings).toContain('validation.cms_shape === true');
    expect(collectorSettings).toContain("status: cmsValidated || directMediaValidated ? 'validated' : 'rejected'");
    expect(collectorSettings).toContain('registerValidatedCmsSource');
    expect(collectorWorkflow).toContain('validation.cms_shape !== true || validation.reachable !== true');
    expect(collectorWorkflow).toContain('store.addCustomApi');
    expect(collectorValidationRoute).toContain('guardPrivateFeatureRequest(request)');
    expect(collectorValidationRoute).toContain('/validate');
  });

  it('keeps the shared player inline on iOS and preserves the fixed four-item dock', () => {
    const playerShell = read('src/components/player-shell.tsx');
    const mobileLayout = read('src/app/iphone-glass.css');
    expect(playerShell).toContain('playsInline: true');
    expect(playerShell).toContain('backdrop: false');
    expect(playerShell).toContain('moreVideoAttr: { crossOrigin: \'anonymous\', playsInline: true }');
    expect(playerShell).toContain('setShowPlayFallback(true)');
    expect(playerShell).toContain('轻点开始播放');
    expect(playerShell).toContain('void art.play().then(() => setShowPlayFallback(false))');
    expect(mobileLayout).toContain('.v4-mobile-tabbar {');
    expect(mobileLayout).toContain('position: fixed;');
    expect(mobileLayout).toContain('bottom: 0;');
    expect(mobileLayout).toContain('env(safe-area-inset-bottom, 0px)');
  });

  it('applies light-theme colors to routed iPhone screens and keeps safe-area paint below the dock', () => {
    expect(theme).toContain(':root:not(.dark) .v4-spatial-screen');
    expect(theme).toContain(':root:not(.dark) .v4-spatial-screen .v4-resource-search input');
    expect(theme).toContain('html.dark .v4-mobile-tabbar');
    expect(theme).toContain('html.dark .v4-header:not(.is-overlay) .v4-search input');
    expect(theme).toContain('-webkit-text-fill-color: #F7F8FA !important;');
    expect(safeArea).toContain('z-index: 1;');
    expect(safeArea).not.toContain('2147483000');
  });
});
