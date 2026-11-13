#!/usr/bin/env node
/**
 * Exercise LibreTV's actual WatchPage + PlayerShell + ArtPlayer + hls.js
 * against real public HLS streams. The URL query is changed in-place so the
 * React PlayerShell must switch sources while retaining its video element.
 */
import { chromium } from 'playwright';

const base = process.env.PR84_PREVIEW_URL || 'https://libretv-pr84-preview.bggdbh.workers.dev';
const streams = {
  fmp4: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
  aes128: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel-aes.ism/.m3u8',
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: [],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const params = new URLSearchParams({
    source: 'preview-smoke',
    sourceUrl: 'https://example.com/api.php/provide/vod',
    url: streams.fmp4,
    title: 'LibreTV Player Acceptance',
  });
  const response = await page.goto(base + '/watch?' + params.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  if (!response || response.status() !== 200) {
    throw new Error('WatchPage returned HTTP ' + (response?.status() ?? 'no response'));
  }

  await page.waitForSelector('video', { timeout: 45_000 });
  await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) throw new Error('PlayerShell video element is missing');
    video.muted = true;
    video.volume = 0;
    void video.play().catch(() => undefined);
  });
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && video.currentTime >= 1.5 &&
      video.videoWidth > 0 && video.videoHeight > 0);
  }, null, { timeout: 45_000 });

  const first = await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) throw new Error('PlayerShell video disappeared');
    window.__pr84PlayerVideo = video;
    return {
      currentTime: video.currentTime,
      readyState: video.readyState,
      width: video.videoWidth,
      height: video.videoHeight,
      currentSrc: video.currentSrc,
    };
  });
  console.log('PASS LibreTV PlayerShell fMP4 playback:', JSON.stringify(first));

  await page.evaluate((url) => {
    const video = document.querySelector('video');
    if (!video) throw new Error('PlayerShell video disappeared before source switch');
    window.__pr84SwitchEvents = [];
    for (const name of ['emptied', 'loadstart', 'loadedmetadata', 'playing']) {
      video.addEventListener(name, () => window.__pr84SwitchEvents.push(name));
    }
    const next = new URL(window.location.href);
    next.searchParams.set('url', url);
    window.history.pushState({}, '', next.toString());
  }, streams.aes128);

  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video === window.__pr84PlayerVideo &&
      window.__pr84SwitchEvents?.includes('loadstart') &&
      video.readyState >= 2 && video.currentTime >= 1.5 &&
      video.videoWidth > 0 && video.videoHeight > 0);
  }, null, { timeout: 60_000 });

  const second = await page.evaluate(() => {
    const video = document.querySelector('video');
    return {
      sameVideoElement: video === window.__pr84PlayerVideo,
      switchEvents: window.__pr84SwitchEvents,
      currentTime: video?.currentTime ?? 0,
      readyState: video?.readyState ?? 0,
      width: video?.videoWidth ?? 0,
      height: video?.videoHeight ?? 0,
      currentSrc: video?.currentSrc ?? '',
    };
  });
  if (!second.sameVideoElement) throw new Error('PlayerShell replaced the video element during source switching');
  if (errors.length > 0) throw new Error('Player console errors: ' + errors.slice(0, 8).join(' | '));

  await page.screenshot({ path: '/tmp/pr84-preview-player.png', fullPage: false });
  console.log('PASS LibreTV PlayerShell AES-128 source switch on the same video element:', JSON.stringify(second));
} finally {
  await browser.close();
}
