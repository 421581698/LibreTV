#!/usr/bin/env node
/**
 * WebKit mobile-viewport acceptance against the exact deployed PR84 Preview.
 * This is a WebKit mobile emulation check, not a physical iPhone Safari run.
 */
import { webkit } from 'playwright';

const base = process.env.PR84_PREVIEW_URL || 'https://libretv-pr84-preview.bggdbh.workers.dev';
const browser = await webkit.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  // Attach diagnostics BEFORE navigation so fast API responses are not missed.
  const apiResponses = [];
  const apiReads = [];
  const imageProxyResponses = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText ?? 'request failed',
  }));
  page.on('response', (response) => {
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (url.pathname.startsWith('/api/douban') ||
        url.pathname.startsWith('/api/hot-list') ||
        url.pathname.startsWith('/api/bangumi/calendar')) {
      const record = { path: url.pathname + url.search, status: response.status(), itemCount: null };
      apiResponses.push(record);
      apiReads.push(response.json().then((payload) => {
        if (Array.isArray(payload?.items)) record.itemCount = payload.items.length;
        else if (Array.isArray(payload?.days)) {
          record.itemCount = payload.days.reduce((sum, day) => sum + (Array.isArray(day.items) ? day.items.length : 0), 0);
        }
      }).catch(() => {}));
    }
    if (url.pathname === '/api/proxy') {
      imageProxyResponses.push({ status: response.status(), contentType: response.headers()['content-type'] ?? '' });
    }
  });

  const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!response || response.status() !== 200) {
    throw new Error('Preview homepage returned HTTP ' + (response?.status() ?? 'no response'));
  }
  await page.waitForSelector('.v4-home', { timeout: 45_000 });
  await page.waitForSelector('.v4-home-main--cinema > .v4-hero-immersive', { timeout: 45_000 });
  await page.waitForSelector('body > nav.v4-mobile-tabbar', { timeout: 45_000 });

  // Wait for settled content, not merely skeleton shells. A timeout is reported
  // with the API/page diagnostics below rather than being mistaken for success.
  try {
    await page.waitForFunction(() => {
      const heroSettled = Boolean(
        document.querySelector('.v4-hero-image img') ||
        document.querySelector('.v4-hero-empty')
      );
      const rails = Array.from(document.querySelectorAll('.v4-apple-rail-section'));
      return heroSettled && rails.length >= 3 && rails.every((section) =>
        section.querySelector('.v4-apple-poster-card, .v4-apple-rail-message')
      );
    }, { timeout: 45_000 });
  } catch {
    const pending = await page.evaluate(() => ({
      hero: document.querySelector('.v4-hero-empty')?.textContent?.trim() ??
        (document.querySelector('.v4-hero-image') ? 'image element present' : 'missing'),
      rails: Array.from(document.querySelectorAll('.v4-apple-rail-section')).map((section) => ({
        title: section.getAttribute('aria-label'),
        cards: section.querySelectorAll('.v4-apple-poster-card').length,
        skeletons: section.querySelectorAll('.v4-apple-poster-skeleton').length,
        message: section.querySelector('.v4-apple-rail-message')?.textContent?.trim() ?? null,
      })),
    }));
    throw new Error('Homepage data did not settle: ' + JSON.stringify({
      pending, apiResponses, imageProxyResponses, pageErrors, failedRequests,
    }));
  }

  try {
    await page.waitForFunction(() => {
      const images = Array.from(document.querySelectorAll('.v4-hero-image img, .v4-apple-poster-card img'));
      return images.some((img) => img instanceof HTMLImageElement &&
        !img.currentSrc.startsWith('data:') && img.complete && img.naturalWidth > 0);
    }, { timeout: 20_000 });
  } catch {
    const imageState = await page.evaluate(() => Array.from(
      document.querySelectorAll('.v4-hero-image img, .v4-apple-poster-card img')
    ).map((img) => ({
      src: img.currentSrc || img.getAttribute('src') || '',
      complete: img.complete,
      naturalWidth: img.naturalWidth,
    })));
    await Promise.all(apiReads);
    throw new Error('Remote poster images did not load: ' + JSON.stringify({
      imageState, apiResponses, imageProxyResponses, pageErrors, failedRequests,
    }));
  }

  const contentState = await page.evaluate(() => {
    const heroImg = document.querySelector('.v4-hero-image img');
    const posterImages = Array.from(document.querySelectorAll('.v4-apple-poster-card img'));
    const realImages = [heroImg, ...posterImages].filter((img) =>
      img instanceof HTMLImageElement &&
      !img.currentSrc.startsWith('data:') &&
      img.complete && img.naturalWidth > 0
    );
    return {
      heroTitle: document.querySelector('.v4-hero-content h1')?.textContent?.trim() ?? null,
      heroHasRemoteArtwork: Boolean(heroImg instanceof HTMLImageElement &&
        !heroImg.currentSrc.startsWith('data:') && heroImg.complete && heroImg.naturalWidth > 0),
      posterCards: document.querySelectorAll('.v4-apple-poster-card').length,
      loadedRemoteImages: realImages.length,
      railStates: Array.from(document.querySelectorAll('.v4-apple-rail-section')).map((section) => ({
        title: section.getAttribute('aria-label'),
        cards: section.querySelectorAll('.v4-apple-poster-card').length,
        message: section.querySelector('.v4-apple-rail-message')?.textContent?.trim() ?? null,
      })),
    };
  });
  await Promise.all(apiReads);
  const successfulFeed = apiResponses.some((entry) => entry.status === 200 && (entry.itemCount ?? 0) > 0);
  if (!successfulFeed || contentState.posterCards < 1 || contentState.loadedRemoteImages < 1) {
    throw new Error('Homepage real data/artwork acceptance failed: ' + JSON.stringify({
      contentState, apiResponses, imageProxyResponses, pageErrors, failedRequests,
    }));
  }
  if (pageErrors.length > 0) {
    throw new Error('Homepage JavaScript errors: ' + JSON.stringify(pageErrors));
  }

  const before = await page.evaluate(() => {
    const header = document.querySelector('.v4-home > .v4-header');
    const headerInner = header?.querySelector('.v4-header-inner');
    const hero = document.querySelector('.v4-home-main--cinema > .v4-hero-immersive');
    const dock = document.querySelector('body > nav.v4-mobile-tabbar');
    if (!header || !hero || !dock) throw new Error('Required cinema header, hero, or dock is missing');
    const headerStyle = getComputedStyle(header);
    const heroRect = hero.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const safeTop = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top')) || 0;
    return {
      headerBackground: headerStyle.backgroundColor,
      headerBackdrop: headerStyle.backdropFilter || headerStyle.webkitBackdropFilter,
      headerHeight: headerInner?.getBoundingClientRect().height ?? header.getBoundingClientRect().height,
      heroHeight: heroRect.height,
      viewportHeight: window.innerHeight,
      dockPosition: getComputedStyle(dock).position,
      dockLeft: dockRect.left,
      dockWidth: dockRect.width,
      dockBottomGap: window.innerHeight - dockRect.bottom,
      safeTop,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
  if (!/^rgba?\(0,\s*0,\s*0,\s*0\)$/.test(before.headerBackground.replace(/\s+/g, ' ').trim())) {
    throw new Error('Homepage header still paints a background surface: ' + before.headerBackground);
  }
  if (before.headerBackdrop && before.headerBackdrop !== 'none') {
    throw new Error('Homepage header still applies a backdrop surface: ' + before.headerBackdrop);
  }
  if (before.dockPosition !== 'fixed') throw new Error('Mobile dock is not fixed: ' + before.dockPosition);
  if (Math.abs(before.dockLeft) > 1 || Math.abs(before.dockWidth - 390) > 2) {
    throw new Error('Mobile dock drifted horizontally: ' + JSON.stringify({ left: before.dockLeft, width: before.dockWidth }));
  }
  if (before.dockBottomGap > 2 || before.dockBottomGap < -2) {
    throw new Error('Mobile dock is not anchored to the bottom edge: ' + before.dockBottomGap);
  }
  const heroBudget = Math.min(before.viewportHeight * 0.55, before.viewportHeight - 68 - before.safeTop - 132);
  if (before.heroHeight < 360 || before.heroHeight > Math.min(520, heroBudget) + 2) {
    throw new Error('Hero height is outside the agreed first-screen budget: ' + JSON.stringify({ hero: before.heroHeight, budget: heroBudget }));
  }
  if (before.documentHeight <= before.viewportHeight) {
    throw new Error('Homepage has no scrollable content to verify dock stability');
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const dock = document.querySelector('body > nav.v4-mobile-tabbar');
    const rect = dock.getBoundingClientRect();
    return { left: rect.left, width: rect.width, bottomGap: window.innerHeight - rect.bottom };
  });
  if (Math.abs(after.left) > 1 || Math.abs(after.width - 390) > 2 || Math.abs(after.bottomGap) > 2) {
    throw new Error('Mobile dock moved after page scroll: ' + JSON.stringify(after));
  }

  await page.screenshot({ path: '/tmp/pr84-preview-webkit.png', fullPage: true });
  console.log('PASS PR84 Preview WebKit mobile layout + real data + remote artwork:', JSON.stringify({
    before, after, contentState, apiResponses, imageProxyResponses,
  }));

  // Exercise the watch route separately: its body-portaled dock previously
  // missed the home/search/spatial selectors and collapsed into a vertical capsule.
  const watchParams = new URLSearchParams({
    source: 'preview-smoke',
    sourceUrl: 'https://example.com/api.php/provide/vod',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    title: 'PR84 Watch Layout Acceptance',
  });
  const watchResponse = await page.goto(base + '/watch?' + watchParams.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  if (!watchResponse || watchResponse.status() !== 200) {
    throw new Error('WatchPage returned HTTP ' + (watchResponse?.status() ?? 'no response'));
  }
  await page.waitForSelector('.watch-topbar', { timeout: 45_000 });
  await page.waitForSelector('.netflix-player-frame', { timeout: 45_000 });
  await page.waitForSelector('body > nav.v4-mobile-tabbar', { state: 'attached', timeout: 45_000 });
  await page.waitForSelector('.player-quality-badge', { timeout: 45_000 });

  // Do not measure the timeline while ArtPlayer is still in its loading shell.
  // The earlier check could pass with a 0x0 playhead because it only enforced
  // an upper bound. Require a genuinely decoded, advancing video first.
  await page.waitForFunction(() => {
    const video = document.querySelector('.netflix-player-frame video');
    return video instanceof HTMLVideoElement &&
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      video.currentTime >= 1.5 &&
      Number.isFinite(video.duration) &&
      video.duration > 0;
  }, { timeout: 60_000 });

  const watchLayout = await page.evaluate(() => {
    const header = document.querySelector('.watch-topbar');
    const title = document.querySelector('.watch-topbar-title');
    const dock = document.querySelector('body > nav.v4-mobile-tabbar');
    const watchShell = document.querySelector('.netflix-watch-shell');
    const frame = document.querySelector('.netflix-player-frame');
    const bottom = frame?.querySelector('.artplayer .art-bottom, .art-video-player .art-bottom');
    const quality = frame?.querySelector('.player-quality-badge');
    const relatedSectionCount = document.querySelectorAll('.netflix-related-section').length;
    const fridayLauncher = document.querySelector('.friday-root .friday-fab, .friday-root .friday-restore');
    const progressBar = frame?.querySelector('.artplayer .art-progress, .art-video-player .art-progress, .artplayer .art-progress-bar, .art-video-player .art-progress-bar');
    const progressTrack = frame?.querySelector('.artplayer .art-progress-loaded, .art-video-player .art-progress-loaded, .artplayer .art-progress-played, .art-video-player .art-progress-played');
    const progressDot = frame?.querySelector('.artplayer .art-progress-indicator, .art-video-player .art-progress-indicator');
    const relatedDataFallbacks = document.querySelectorAll('.netflix-related-art img[src^="data:"]').length;
    const emptyHistory = Array.from(document.querySelectorAll('.netflix-history-rail p'))
      .some((node) => node.textContent?.includes('还没有其他观看记录'));
    if (!header || !title || !dock || !watchShell || !frame) throw new Error('Watch page layout elements are missing');
    const dockStyle = getComputedStyle(dock);
    const shellStyle = getComputedStyle(watchShell);
    const shellRect = watchShell.getBoundingClientRect();
    const titleStyle = getComputedStyle(title);
    const gradient = bottom ? getComputedStyle(bottom).backgroundImage : '';
    return {
      title: title.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      titleAlign: titleStyle.textAlign,
      headerButtons: header.querySelectorAll('button').length,
      hasHeaderAssistant: Boolean(header.querySelector('.friday-orb, .friday-fab, .friday-restore')),
      shellPosition: shellStyle.position,
      shellWidth: shellRect.width,
      shellHeight: shellRect.height,
      dockDisplay: dockStyle.display,
      emptyHistory,
      historyLinkCount: document.querySelectorAll('.netflix-section-heading a[href="/me"]').length,
      playerBottomGradient: gradient,
      qualityFontSize: quality ? getComputedStyle(quality).fontSize : null,
      relatedSectionCount,
      fridayLauncherDisplay: fridayLauncher ? getComputedStyle(fridayLauncher).display : 'absent',
      progressHitAreaHeight: progressBar ? getComputedStyle(progressBar).height : null,
      progressHitAreaRect: progressBar ? (() => { const r = progressBar.getBoundingClientRect(); return { width: r.width, height: r.height, x: r.x, y: r.y }; })() : null,
      progressTrackHeight: progressTrack ? getComputedStyle(progressTrack).height : null,
      progressTrackRect: progressTrack ? (() => { const r = progressTrack.getBoundingClientRect(); return { width: r.width, height: r.height, x: r.x, y: r.y }; })() : null,
      progressDotWidth: progressDot ? getComputedStyle(progressDot).width : null,
      progressDotRect: progressDot ? (() => { const r = progressDot.getBoundingClientRect(); return { width: r.width, height: r.height }; })() : null,
      progressPointerEvents: progressBar ? getComputedStyle(progressBar).pointerEvents : null,
      relatedDataFallbacks,
    };
  });
  if (!watchLayout.title.includes('PR84 Watch Layout Acceptance') || watchLayout.titleAlign !== 'left') {
    throw new Error('Watch header title is not aligned with the back control: ' + JSON.stringify(watchLayout));
  }
  if (watchLayout.headerButtons !== 2 || watchLayout.hasHeaderAssistant) {
    throw new Error('Watch header must contain only the back and episode/source panel controls: ' + JSON.stringify(watchLayout));
  }
  if (watchLayout.shellPosition !== 'fixed' || Math.abs(watchLayout.shellWidth - 390) > 2 ||
      Math.abs(watchLayout.shellHeight - 844) > 2) {
    throw new Error('Watch player shell is not filling the mobile viewport: ' + JSON.stringify(watchLayout));
  }
  if (watchLayout.dockDisplay !== 'none') {
    throw new Error('Immersive watch mode must hide the global mobile navigation dock: ' + JSON.stringify(watchLayout));
  }
  if (watchLayout.emptyHistory && watchLayout.historyLinkCount !== 0) {
    throw new Error('Empty continue-watching state still shows the all-history link');
  }
  if (!watchLayout.playerBottomGradient.includes('linear-gradient')) {
    throw new Error('Player bottom controls are missing their dark gradient protection: ' + JSON.stringify(watchLayout));
  }
  if (watchLayout.qualityFontSize !== '12px') {
    throw new Error('Player quality badge is not compact 12px text: ' + JSON.stringify(watchLayout));
  }
  if (watchLayout.relatedSectionCount !== 0) {
    throw new Error('The removed related-movies section is still present on the watch page: ' + JSON.stringify(watchLayout));
  }
  if (watchLayout.fridayLauncherDisplay !== 'none' && watchLayout.fridayLauncherDisplay !== 'absent') {
    throw new Error('Floating Friday starfield launcher still overlaps the watch page: ' + JSON.stringify(watchLayout));
  }
  if (!watchLayout.progressHitAreaRect || watchLayout.progressHitAreaRect.height < 12 ||
      watchLayout.progressHitAreaRect.height > 20 ||
      !watchLayout.progressTrackRect || watchLayout.progressTrackRect.width <= 0 ||
      watchLayout.progressTrackRect.height < 1 ||
      watchLayout.progressTrackRect.height > 3 ||
      !watchLayout.progressDotRect ||
      watchLayout.progressDotRect.width < 4 || watchLayout.progressDotRect.width > 8 ||
      watchLayout.progressDotRect.height < 4 || watchLayout.progressDotRect.height > 8 ||
      watchLayout.progressPointerEvents === 'none') {
    throw new Error('Real mobile ArtPlayer timeline geometry is invalid (target 12–20px, rail 1–3px, playhead <=8px, pointer events enabled): ' + JSON.stringify(watchLayout));
  }
  if (watchLayout.relatedDataFallbacks !== 0) {
    throw new Error('Related posters are still using decorative data-URI fallbacks: ' + JSON.stringify(watchLayout));
  }
  await page.screenshot({ path: '/tmp/pr84-preview-watch-webkit.png', fullPage: true });
  console.log('PASS PR84 Preview WebKit watch-page header + player controls + horizontal dock:', JSON.stringify(watchLayout));
} finally {
  await browser.close();
}
