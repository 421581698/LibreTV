import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCinemaActivation } from './container';
import { isIpadClassDevice } from './device';
import {
  activePointerSignals,
  minimumScrollDelta,
  moveIndex,
  nearestByPosition,
  preserveIndex,
  resolvedFocusAxis,
} from './focus-engine';
import {
  applyAttributes,
  parseRoute,
  projectAttributes,
  projectLiveChrome,
  reconcilePlayerRoute,
} from './route';
import {
  createSession,
  enterDetail,
  enterPlayer,
  exitPlayer,
  goBack,
  INITIAL_FOCUS,
  recover,
  resetToHome,
  setActivation,
  setDetailCapsule,
  updateFocus,
} from './session';
import { IPAD_CINEMA_TOKENS, tokensWithinLimits } from './tokens';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const stage = () => createSession({ activation: 'stage' });

describe('iPad cinema device and container', () => {
  it('treats keyboard iPadOS as iPad even when the pointer is fine', () => {
    expect(isIpadClassDevice({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })).toBe(true);
    expect(isIpadClassDevice({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)',
      platform: 'iPad',
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it('does not treat iPhone or desktop machines as iPad', () => {
    expect(isIpadClassDevice({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
    })).toBe(false);
    expect(isIpadClassDevice({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    })).toBe(false);
    expect(isIpadClassDevice({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      maxTouchPoints: 10,
    })).toBe(false);
  });

  it('selects cinema bands from container width, with no 1440 cap', () => {
    expect(resolveCinemaActivation(false, 1366)).toBe('inactive');
    expect(resolveCinemaActivation(true, 699)).toBe('inactive');
    expect(resolveCinemaActivation(true, 700)).toBe('compact');
    expect(resolveCinemaActivation(true, 1023)).toBe('compact');
    expect(resolveCinemaActivation(true, 1024)).toBe('stage');
    expect(resolveCinemaActivation(true, 1600)).toBe('stage');
    expect(resolveCinemaActivation(true, Number.NaN)).toBe('inactive');
  });
});

describe('adaptive navigation session', () => {
  it('shows the home sidebar only on the stage band and always shows the capsule', () => {
    const compact = projectLiveChrome(createSession({ activation: 'compact' }), { kind: 'home' });
    const wide = projectLiveChrome(stage(), { kind: 'home' });
    expect(compact).toEqual({ sidebar: 'hidden', capsule: 'visible', back: 'hidden' });
    expect(wide).toEqual({ sidebar: 'visible', capsule: 'visible', back: 'hidden' });
  });

  it('forces the detail sidebar off, keeps the baseline capsule, and uses an independent back', () => {
    const detail = projectLiveChrome(stage(), { kind: 'detail', key: 'src::1' });
    expect(detail).toEqual({ sidebar: 'hidden', capsule: 'visible', back: 'independent' });
    const hiddenCapsule = projectLiveChrome(
      setDetailCapsule(stage(), 'hidden').session,
      { kind: 'detail', key: 'src::1' },
    );
    expect(hiddenCapsule?.capsule).toBe('hidden');
  });

  it('restores nested detail focus one level at a time and does not jump home', () => {
    const homeFocus = { ...INITIAL_FOCUS, regionId: 'hero', index: 2, scrollOffset: 40, preferredAxis: 'horizontal' as const };
    let session = updateFocus(stage(), homeFocus).session;
    session = enterDetail(session, 'a').session;
    session = updateFocus(session, { ...INITIAL_FOCUS, regionId: 'actions', index: 1, scrollOffset: 8, preferredAxis: 'horizontal' }).session;
    session = enterDetail(session, 'b').session;

    const backToA = goBack(session);
    expect(backToA.historyAction).toBe('back-once');
    expect(backToA.session.page).toEqual({ type: 'detail', key: 'a' });
    expect(backToA.session.focus.regionId).toBe('actions');
    expect(backToA.session.focus.index).toBe(1);
    expect(backToA.session.stack).toHaveLength(1);

    const backHome = goBack(backToA.session);
    expect(backHome.session.page).toEqual({ type: 'home' });
    expect(backHome.session.focus).toEqual(homeFocus);
    expect(backHome.historyAction).toBe('back-once');
    expect(goBack(backHome.session).historyAction).toBe('none');
  });

  it('keeps a deep-linked detail on router back instead of inventing a home route', () => {
    const session = { ...stage(), page: { type: 'detail' as const, key: 'src::9' } };
    const back = goBack(session);
    expect(back.historyAction).toBe('back-once');
    expect(back.session.page).toEqual({ type: 'detail', key: 'src::9' });
    expect(back.session).toBe(session);
  });

  it('treats fullscreen playback as a presentation and pops history once', () => {
    let session = enterDetail(stage(), 'a').session;
    const stack = session.stack;
    session = enterPlayer(session, { presentation: 'fullscreen', routeOwned: true }).session;
    expect(session.stack).toBe(stack);
    expect(projectLiveChrome(session, { kind: 'watch' })).toEqual({
      sidebar: 'hidden',
      capsule: 'hidden',
      back: 'player-close',
    });

    const exited = exitPlayer(session);
    expect(exited.historyAction).toBe('back-once');
    expect(exited.session.player).toBeNull();
    expect(exited.session.page).toEqual({ type: 'detail', key: 'a' });
    expect(exited.session.stack).toHaveLength(1);
    expect(exitPlayer(exited.session)).toEqual({ session: exited.session, historyAction: 'none' });
  });

  it('does not pop history for an overlay fullscreen or a floating player', () => {
    const overlay = exitPlayer(enterPlayer(stage(), { presentation: 'fullscreen', routeOwned: false }).session);
    expect(overlay.historyAction).toBe('none');

    let floating = enterDetail(stage(), 'a').session;
    floating = enterPlayer(floating, { presentation: 'floating', routeOwned: false }).session;
    expect(exitPlayer(floating).historyAction).toBe('none');
    expect(projectLiveChrome(floating, { kind: 'detail', key: 'a' })?.capsule).toBe('visible');
    expect(projectLiveChrome(floating, { kind: 'detail', key: 'a' })?.sidebar).toBe('hidden');

    const back = goBack(floating);
    expect(back.session.player?.presentation).toBe('floating');
    expect(back.session.page).toEqual({ type: 'home' });
    expect(projectLiveChrome(back.session, { kind: 'home' })?.sidebar).toBe('visible');
  });

  it('refuses to open another detail under fullscreen and recovers without a history pop', () => {
    const playing = enterPlayer(enterDetail(stage(), 'a').session, {
      presentation: 'fullscreen',
      routeOwned: true,
    }).session;
    expect(enterDetail(playing, 'b').session).toBe(playing);
    expect(resetToHome(playing).session).toBe(playing);

    const recovered = recover(playing);
    expect(recovered.historyAction).toBe('none');
    expect(recovered.session.player).toBeNull();
    expect(projectLiveChrome(recovered.session, { kind: 'detail', key: 'a' })?.back).toBe('independent');
    expect(recover(recovered.session).session).toBe(recovered.session);
  });

  it('reconciles /watch without a second pop when the browser has already left it', () => {
    let session = enterDetail(stage(), 'a').session;
    session = reconcilePlayerRoute(session, { kind: 'watch' }).session;
    session = reconcilePlayerRoute(session, { kind: 'watch' }).session;
    expect(session.player).toEqual({ presentation: 'fullscreen', routeOwned: true });

    const left = reconcilePlayerRoute(session, { kind: 'detail', key: 'a' });
    expect(left.historyAction).toBe('none');
    expect(left.session.player).toBeNull();
    expect(left.session.page).toEqual({ type: 'detail', key: 'a' });
    expect(left.session.stack).toHaveLength(1);
  });

  it('keeps a floating player when the route is not /watch', () => {
    const floating = enterPlayer(stage(), { presentation: 'floating', routeOwned: false }).session;
    expect(reconcilePlayerRoute(floating, { kind: 'home' }).session).toBe(floating);
  });

  it('gives focus its own slice and lets activation resize chrome without wiping memory', () => {
    const focused = updateFocus(enterDetail(stage(), 'a').session, {
      regionId: 'rail-1',
      index: 3,
      scrollOffset: 80,
      preferredAxis: 'horizontal',
    }).session;
    const resized = setActivation(focused, 'compact').session;
    expect(resized.stack).toBe(focused.stack);
    expect(resized.focus).toBe(focused.focus);
    expect(resized.page).toEqual(focused.page);
    expect(projectLiveChrome(resized, { kind: 'home' })?.sidebar).toBe('hidden');
    expect(setActivation(resized, 'compact').session).toBe(resized);
  });

  it('releases ownership below the cinema band and on unmanaged routes', () => {
    const inactive = setActivation(stage(), 'inactive').session;
    expect(projectAttributes(inactive, { kind: 'home' })['data-nav-owner']).toBeNull();
    expect(projectAttributes(stage(), { kind: 'other', path: '/search' })['data-nav-owner']).toBeNull();
    expect(projectLiveChrome(inactive, { kind: 'detail', key: 'a' })).toBeNull();
  });

  it('writes navigation attributes from one projection and clears them together', () => {
    const element = {
      attrs: new Map<string, string>(),
      setAttribute(name: string, value: string) { this.attrs.set(name, value); },
      removeAttribute(name: string) { this.attrs.delete(name); },
    };
    applyAttributes(element, projectAttributes(stage(), { kind: 'home' }));
    expect(element.attrs.get('data-nav-owner')).toBe('adaptive');
    expect(element.attrs.get('data-ipad-cinema')).toBe('stage');
    expect(element.attrs.get('data-nav-sidebar')).toBe('visible');
    expect(element.attrs.get('data-focus-axis')).toBe('horizontal');

    applyAttributes(element, projectAttributes(createSession({ activation: 'compact' }), { kind: 'home' }));
    expect(element.attrs.get('data-nav-sidebar')).toBe('hidden');
    expect(element.attrs.get('data-focus-axis')).toBe('vertical');
    expect(element.attrs.get('data-nav-owner')).toBe('adaptive');

    applyAttributes(element, projectAttributes(stage(), { kind: 'other', path: '/settings' }));
    expect(element.attrs.size).toBe(0);
  });

  it('parses the owned routes and ignores a trailing slash', () => {
    expect(parseRoute('/detail/', '?source=ff&id=12')).toEqual({ kind: 'detail', key: 'ff::12' });
    expect(parseRoute('/watch')).toEqual({ kind: 'watch' });
    expect(parseRoute('/movies/')).toEqual({ kind: 'other', path: '/movies' });
    expect(parseRoute('/')).toEqual({ kind: 'home' });
  });

  it('resets to home only when fullscreen playback is not covering the page', () => {
    const nested = enterDetail(enterDetail(stage(), 'a').session, 'b').session;
    const home = resetToHome(nested);
    expect(home.session.page).toEqual({ type: 'home' });
    expect(home.session.stack).toEqual([]);
    expect(home.historyAction).toBe('none');
    const playing = enterPlayer(nested, { presentation: 'fullscreen', routeOwned: true }).session;
    expect(resetToHome(playing).session).toBe(playing);
  });
});

describe('focus engine', () => {
  it('preserves horizontal position and picks the nearest item when the next rail is shorter', () => {
    expect(preserveIndex(5, 3)).toBe(2);
    expect(preserveIndex(1, 4)).toBe(1);
    expect(preserveIndex(2, 0)).toBe(0);
    expect(nearestByPosition(140, [0, 100, 200])).toBe(1);
    expect(nearestByPosition(0, [])).toBe(0);
  });

  it('scrolls only the overflow distance', () => {
    expect(minimumScrollDelta({ viewportStart: 0, viewportSize: 300, itemStart: 20, itemSize: 80 })).toBe(0);
    expect(minimumScrollDelta({ viewportStart: 0, viewportSize: 300, itemStart: 280, itemSize: 80 })).toBe(60);
    expect(minimumScrollDelta({ viewportStart: 100, viewportSize: 300, itemStart: 70, itemSize: 40 })).toBe(-30);
  });

  it('keeps the engine in compact containers by degrading horizontal rails to vertical movement', () => {
    expect(resolvedFocusAxis('compact', 'horizontal')).toBe('vertical');
    expect(resolvedFocusAxis('compact', 'vertical')).toBe('vertical');
    expect(resolvedFocusAxis('stage', 'horizontal')).toBe('horizontal');
    expect(resolvedFocusAxis('inactive', 'horizontal')).toBe('horizontal');
    expect(moveIndex(0, 1, 3)).toBe(1);
    expect(moveIndex(2, 1, 3)).toBe(2);
  });

  it('does not merge touch, hover, focus and pressed', () => {
    expect(activePointerSignals({ touch: true, hover: false, focus: true, pressed: false })).toEqual(['touch', 'focus']);
    expect(activePointerSignals({ touch: false, hover: true, focus: false, pressed: true })).toEqual(['hover', 'pressed']);
  });
});

describe('V4.3.1 contract wiring', () => {
  const layout = read('src/app/layout.tsx');
  const contract = read('src/components/ipad-cinema/IpadCinemaContract.tsx');
  const css = read('src/app/ipad-cinema.css');
  const player = read('src/components/player-shell.tsx');
  const detail = read('src/components/movie-detail-page.tsx');
  const header = read('src/components/home/V4HomepageHeader.tsx');

  it('loads the ownership layer last and mounts one contract writer', () => {
    expect(layout.indexOf("import './ipad-cinema.css';")).toBeGreaterThan(layout.indexOf("import './resource-studio.css';"));
    expect(layout.indexOf("import './ipad-cinema.css';")).toBeGreaterThan(layout.indexOf("import './pr84-apple-tv-dock.css';"));
    expect(layout).toContain("import { IpadCinemaContract } from '@/components/ipad-cinema/IpadCinemaContract';");
    expect(layout).toContain('<IpadCinemaContract />');
    expect(contract).toContain('applyAttributes(document.documentElement, projectAttributes(session, route));');
    expect(contract).not.toContain('router.back');
    expect(contract).not.toContain('router.push');
    expect(contract).toContain("detail: { focusId: 'region:primary-navigation:index:0', reason: 'navigation' }");
    expect(header).toContain('data-ipad-focus-id="region:primary-navigation:index:0"');
    expect(header).toContain('tabIndex={-1}');
    expect(contract).toContain('navigator.onLine !== false');
    expect(contract).toContain("transition !== 'offline'");
  });

  it('does not hide the current dock or recapture phone and desktop with a pointer query', () => {
    expect(css).toContain("html[data-nav-owner='adaptive']");
    expect(css).not.toContain('.v4-mobile-tabbar');
    expect(css).not.toContain('display:');
    expect(css).not.toContain('any-pointer');
    expect(css).not.toContain('max-width: 1440');
    expect(css).toContain('--ipad-focus-scale: 1.06;');
    expect(css).toContain('--ipad-glass-blur: 24px;');
    expect(tokensWithinLimits()).toBe(true);
    expect(IPAD_CINEMA_TOKENS.focusScale).toBe(1.06);
    expect(IPAD_CINEMA_TOKENS.glassOpacity).toBe(0.65);
  });

  it('audits the real player kernel instead of assuming subtitle, audio and cast controls', () => {
    expect(player).toContain('pip: false');
    expect(player).toContain('disablePictureInPicture: true');
    expect(player).toContain('playbackRate: true');
    expect(player).toContain('setting: true');
    expect(player).toContain('airplay: true');
    expect(player).toContain('fullscreen: !touchPointer');
    expect(player).toContain('fullscreenWeb: !touchPointer');
    expect(detail).toContain('router.back()');
    expect(detail).toContain('router.push(buildWatchUrl({');
    expect(detail).not.toContain("router.push('/')");
  });

  it('connects interruption decisions to an explicit user-activated resume action', () => {
    expect(player).toContain("document.addEventListener('ipad-cinema:resume-decision', handleResumeDecision)");
    expect(player).toContain("document.removeEventListener('ipad-cinema:resume-decision', handleResumeDecision)");
    expect(player).toContain('点击继续播放');
    expect(player).toContain('void art.play().then(() => {');
    expect(player).toContain("decision === 'resume' || decision === 'ask-user'");
    expect(player).toContain("decision === 'reload-then-resume'");
    expect(player).toContain('if (!video?.paused)');
    expect(player).toContain('当前视频资源已失效，请重新选择播放源后继续');
    expect(player).toContain("kind: 'app-background'");
    expect(player).not.toContain("document.addEventListener('ipad-cinema:resume-decision', () => artRef.current?.play())");
  });
});
