import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const home = read('src/app/page.tsx');
const shell = read('src/components/spatial-os-v4/app/SpatialAppShell.tsx');
const layout = read('src/components/spatial-os-v4/app/SpatialLayout.tsx');
const navigation = read('src/components/spatial-os-v4/navigation/PrimaryNavigation.tsx');
const router = read('src/components/spatial-os-v4/navigation/SpatialRouter.ts');
const fridayEntry = read('src/components/spatial-os-v4/friday/SpatialFridayEntry.tsx');
const fridayButton = read('src/components/spatial-os-v4/friday/FridayAssistantButton.tsx');
const intelligence = read('src/components/spatial-os-v4/spaces/SpatialIntelligenceSpace.tsx');
const taskAudit = read('src/components/spatial-os-v4/spaces/SpatialTaskAuditPanel.tsx');
const resource = read('src/components/spatial-os-v4/spaces/SpatialResourceUniverse.tsx');
const identity = read('src/components/spatial-os-v4/spaces/SpatialIdentitySpace.tsx');
const header = read('src/components/header.tsx');
const css = read('src/components/spatial-os-v4/styles/spatial-shell.css');
const player = read('src/app/watch/page.tsx');
const playerShell = read('src/components/player-shell.tsx');
const taskStore = read('src/lib/friday/dexie-task-event-store.ts');

describe('FRIDAY SPATIAL OS V4 cross-layer regression contracts', () => {
  it('keeps four spaces as view state and persists the active space through the existing Dexie state store', () => {
    expect(router).toContain('"cinematic"');
    expect(router).toContain('"intelligence"');
    expect(router).toContain('"resources"');
    expect(router).toContain('"identity"');
    expect(navigation).toContain('aria-label="主要空间"');
    expect(navigation).toContain('aria-current={active ? \'page\' : undefined}');
    expect(navigation).toContain('onClick={() => onSpaceChange(space)}');
    expect(shell).toContain('resolveSpatialSpace(activeSpace ?? internalSpace)');
    expect(layout).toContain('<PrimaryNavigation');
    expect(home).toContain("readSpatialState<unknown>('active-space')");
    expect(home).toContain("writeSpatialState('active-space', activeSpace)");
    expect(home).toContain('isSpatialSpace(saved)');
    expect(home).not.toContain('router.push(`/spatial');
  });

  it('mounts one V4 shell and renders the selected workspace without replacing Cinematic business content', () => {
    expect(home).toContain('<SpatialAppShell');
    expect(home).toContain("activeSpace === 'cinematic' ? mainContent");
    expect(home).toContain("activeSpace === 'intelligence' ?");
    expect(home).toContain("activeSpace === 'resources' ?");
    expect(home).toContain("activeSpace === 'identity' ?");
    expect(home).toContain('<HomeRecommendationSection');
    expect(home).toContain('<HomeSearchSection');
    expect(home).toContain('<DetailModal');
  });

  it('keeps Friday entry as a view adapter and routes clicks to the pre-existing controller', () => {
    expect(fridayEntry).toContain('getFridaySpatialVisualState({ voice, agent })');
    expect(fridayEntry).toContain("window.addEventListener('friday-home-runtime-state'");
    expect(fridayEntry).toContain("window.removeEventListener('friday-home-runtime-state'");
    expect(fridayEntry).toContain("new CustomEvent('friday-home-orb-toggle')");
    expect(fridayEntry).not.toContain('getUserMedia');
    expect(fridayEntry).not.toContain('SpeechRecognition');
    expect(fridayButton).toContain('<FridayOrb');
    expect(fridayButton).toContain('interactive={false}');
    expect(fridayButton).toContain('state={rendererState}');
    expect(header).toContain('window.addEventListener("friday-home-orb-toggle", handleHomeOrbToggle)');
  });

  it('connects Intelligence to the existing Friday panel and a payload-redacted task audit', () => {
    expect(intelligence).toContain("new CustomEvent('friday-home-open-panel')");
    expect(intelligence).toContain('<SpatialTaskAuditPanel');
    expect(taskAudit).toContain('listRecentTaskAudit()');
    expect(taskAudit).toContain('不会展示用户提示词、输入、结果或原始事件负载');
    expect(taskStore).toContain('async listRecentTaskAudit()');
    expect(taskStore).toContain('eventCount: ordered.length');
    expect(taskStore).not.toContain('prompt: created.payload');
    expect(taskAudit).not.toContain('event.payload');
  });

  it('connects Resource Universe search, category filtering, pagination, favorites and state restoration', () => {
    expect(resource).toContain("fetch('/api/fmhy?' + params.toString())");
    expect(resource).toContain('params.set(\'category\'');
    expect(resource).toContain('params.set(\'q\'');
    expect(resource).toContain('hasMore');
    expect(resource).toContain('loadMore');
    expect(resource).toContain('FavoriteButton');
    expect(resource).toContain("readSpatialState<{ category?: string; query?: string }>('resource-universe')");
    expect(resource).toContain("writeSpatialState('resource-universe'");
    expect(resource).toContain("window.addEventListener('libretv:favorites-changed'");
    expect(resource).toContain('window.removeEventListener');
  });

  it('keeps Identity actions delegated to existing drawers and profile transfer, not duplicate settings stores', () => {
    expect(identity).toContain("new CustomEvent('libretv:open-history')");
    expect(identity).toContain("new CustomEvent('libretv:open-source-settings')");
    expect(identity).toContain("new CustomEvent('friday-home-open-panel')");
    expect(identity).toContain('exportConfig()');
    expect(identity).toContain('importConfig(content)');
    expect(identity).toContain('migrateLegacyLiveFavorites');
    expect(identity).toContain('libretv:spatial-profile-imported');
    expect(header).toContain("window.addEventListener('libretv:open-history'");
    expect(header).toContain("window.addEventListener('libretv:open-source-settings'");
  });

  it('preserves the existing ArtPlayer/HLS runtime and only changes the responsive player workspace', () => {
    expect(player).toContain('dynamic(() => import(\'@/components/player-shell\')');
    expect(player).toContain('<PlayerShell');
    expect(player).toContain('spatial-v4-player-page');
    expect(player).toContain('spatial-v4-player-grid');
    expect(playerShell).toContain('new Artplayer');
    expect(playerShell).toContain('setupHls');
    expect(playerShell).toContain('art.video?.videoHeight');
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('provides tablet/mobile navigation layouts and keyboard-visible focus affordance', () => {
    expect(css).toContain('@media (min-width: 768px) and (max-width: 1199px)');
    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toContain('position: fixed');
    expect(css).toContain('safe-area-inset-bottom');
    expect(css).toContain('.spatial-v4-nav-item:focus-visible');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('does not silently claim cloud sync or automatically replay task side effects', () => {
    expect(identity).toContain('不会把资料上传到公共服务器，也不提供自动云端同步');
    expect(taskStore).toContain('pruneTerminalTasks');
    expect(taskStore).toContain('sideEffect');
    expect(taskStore).toContain('256 KiB persistence limit');
    expect(taskStore).not.toContain('replaySideEffect');
  });
});
