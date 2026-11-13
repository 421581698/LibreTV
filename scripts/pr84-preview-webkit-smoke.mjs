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
  if (!/rgba?\\(0, 0, 0, 0\\)/.test(before.headerBackground)) {
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
} finally {
  await browser.close();
}
