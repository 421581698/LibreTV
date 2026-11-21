#!/usr/bin/env node
/**
 * Chromium mobile-viewport emulation only. This is not iPhone/iPad Safari device acceptance.
 * It exercises responsive layout, rotation-like viewport changes and split-view widths.
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const base = process.env.CINEMA_PREVIEW_URL || 'https://libretv-cinema-v23-preview.bggdbh.workers.dev';
const stream = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8';
const alternateStream = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/v9/prog_index.m3u8';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

try {
  const params = new URLSearchParams({
    // Match the already verified PlayerShell fixture identity so source resolution
    // and preview auth behavior are identical across desktop/mobile smoke runs.
    source: 'preview-smoke',
    sourceUrl: 'https://example.com/api.php/provide/vod',
    url: stream,
    title: 'Cinema V2.3 Mobile Emulation',
  });
  const response = await page.goto(base + '/watch?' + params.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  if (!response || response.status() !== 200) throw new Error('WatchPage did not return HTTP 200.');

  try {
    await page.waitForSelector('.netflix-player-frame video', { timeout: 45_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      title: document.title,
      bodyText: document.body.innerText.slice(0, 1200),
      authDialog: Boolean(document.querySelector('[role="dialog"]')),
      watchShell: Boolean(document.querySelector('.netflix-watch-shell')),
      playerFrame: Boolean(document.querySelector('.netflix-player-frame')),
      status: document.querySelector('main')?.innerText.slice(0, 600) ?? '',
    }));
    await page.screenshot({ path: '/tmp/cinema-v23-mobile-bootstrap-failure.png', fullPage: false });
    throw new Error('Mobile PlayerShell bootstrap did not mount: ' + JSON.stringify({
      state,
      cause: error instanceof Error ? error.message : String(error),
    }));
  }
  await page.evaluate(() => {
    const video = document.querySelector('.netflix-player-frame video');
    if (!video) throw new Error('PlayerShell video missing.');
    window.__cinemaV23Video = video;
    video.muted = true;
    void video.play().catch(() => undefined);
  });
  await page.waitForFunction(() => {
    const video = document.querySelector('.netflix-player-frame video');
    return Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
  }, null, { timeout: 45_000 });

  const profiles = [
    { name: 'iPhone-size portrait viewport', width: 390, height: 844, screenshot: '/tmp/cinema-v23-iphone-portrait.png' },
    { name: 'iPhone-size landscape viewport', width: 844, height: 390, screenshot: '/tmp/cinema-v23-iphone-landscape.png' },
    { name: 'iPad-size landscape viewport', width: 1194, height: 834, screenshot: '/tmp/cinema-v23-ipad-landscape.png' },
    { name: 'iPad split-view width viewport', width: 680, height: 834, screenshot: '/tmp/cinema-v23-ipad-split-view.png' },
  ];

  for (const profile of profiles) {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.waitForTimeout(350);
    const layout = await page.evaluate(() => {
      const video = document.querySelector('.netflix-player-frame video');
      const frame = document.querySelector('.netflix-player-frame');
      const rect = frame?.getBoundingClientRect();
      const videoRect = video?.getBoundingClientRect();
      return {
        videoCount: document.querySelectorAll('video').length,
        sameVideoElement: video === window.__cinemaV23Video,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        frameWidth: rect?.width ?? 0,
        frameHeight: rect?.height ?? 0,
        videoRectWidth: videoRect?.width ?? 0,
        videoRectHeight: videoRect?.height ?? 0,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        assCanvas: (() => {
          const canvas = document.querySelector('canvas.JASSUB');
          const canvasRect = canvas?.getBoundingClientRect();
          return canvasRect ? { width: canvasRect.width, height: canvasRect.height } : null;
        })(),
      };
    });
    if (layout.videoCount !== 1 || !layout.sameVideoElement || layout.frameWidth <= 0 || layout.frameHeight <= 0 ||
        layout.documentWidth > layout.viewportWidth + 2) {
      throw new Error(profile.name + ' layout invariant failed: ' + JSON.stringify(layout));
    }
    if (!layout.assCanvas || layout.assCanvas.width <= 0 || layout.assCanvas.height <= 0 ||
        Math.abs(layout.assCanvas.width - layout.videoRectWidth) > 12 ||
        Math.abs(layout.assCanvas.height - layout.videoRectHeight) > 12) {
      throw new Error(profile.name + ' did not retain a measurable JASSUB canvas after resize: ' + JSON.stringify(layout));
    }

    await page.mouse.move(Math.min(profile.width - 10, Math.round(profile.width / 2)), Math.round(profile.height / 2));
    const subtitleButton = page.locator('button[aria-label="字幕设置"]');
    await subtitleButton.waitFor({ state: 'visible', timeout: 5_000 });
    await subtitleButton.click();
    await page.locator('select[aria-label="选择字幕轨"]').waitFor({ state: 'visible', timeout: 3_000 });
    if (profile.name === 'iPhone-size portrait viewport') {
      await page.locator('input[accept=".ass,.ssa,text/plain"]').setInputFiles(
        resolve('src/lib/native-player/fixtures/minimal.ass'),
      );
      await page.waitForSelector('canvas.JASSUB', { state: 'visible', timeout: 25_000 });
    }
    await subtitleButton.click();

    const spatialButton = page.locator('button[aria-label="空间音频设置"]');
    await spatialButton.waitFor({ state: 'visible', timeout: 5_000 });
    await spatialButton.click();
    await page.getByText('空间音频', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });
    await spatialButton.click();

    await page.screenshot({ path: profile.screenshot, fullPage: false });
    console.log('PASS ' + profile.name + ': ' + JSON.stringify(layout));
  }

  const previousMediaSrc = await page.evaluate((url) => {
    const video = document.querySelector('.netflix-player-frame video');
    if (!video) throw new Error('Video missing before ASS cleanup source switch.');
    const previousSrc = video.currentSrc;
    const next = new URL(window.location.href);
    next.searchParams.set('url', url);
    window.history.pushState({}, '', next.toString());
    window.dispatchEvent(new PopStateEvent('popstate'));
    return previousSrc;
  }, alternateStream);
  await page.waitForFunction((previousSrc) => {
    const video = document.querySelector('.netflix-player-frame video');
    return Boolean(video && video.currentSrc && video.currentSrc !== previousSrc && video.readyState >= 2 && video.videoWidth > 0);
  }, previousMediaSrc, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const video = document.querySelector('.netflix-player-frame video');
    return Boolean(video && video.currentTime >= 1.5);
  }, null, { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('canvas.JASSUB'), null, { timeout: 10_000 });

  if (errors.length) throw new Error('Mobile emulation page errors: ' + errors.slice(0, 8).join(' | '));
  console.log('PASS Chromium responsive/rotation/split-width emulation and JASSUB source-switch cleanup. Physical Safari testing remains required.');
} finally {
  await browser.close();
}
