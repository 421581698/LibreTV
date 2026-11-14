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
const browserChannel = process.env.PR84_BROWSER_CHANNEL?.trim();
const browser = await chromium.launch({
  ...(browserChannel ? { channel: browserChannel } : {}),
  headless: true,
});
const errors = [];
const mediaResponses = [];
const failedRequests = [];
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
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.hostname.includes('apple.com') || url.hostname.includes('unified-streaming.com')) {
      failedRequests.push({ url: url.origin + url.pathname, error: request.failure()?.errorText ?? 'request failed' });
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.hostname.includes('apple.com') || url.hostname.includes('unified-streaming.com')) {
      mediaResponses.push({ url: url.origin + url.pathname, status: response.status(), contentType: response.headers()['content-type'] ?? '' });
    }
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
  try {
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return Boolean(video && video.readyState >= 2 && video.currentTime >= 1.5 &&
        video.videoWidth > 0 && video.videoHeight > 0);
    }, null, { timeout: 45_000 });
  } catch (error) {
    const state = await page.evaluate(() => {
      const video = document.querySelector('video');
      return video ? {
        currentTime: video.currentTime,
        readyState: video.readyState,
        networkState: video.networkState,
        width: video.videoWidth,
        height: video.videoHeight,
        paused: video.paused,
        currentSrc: video.currentSrc,
        mediaError: video.error ? { code: video.error.code, message: video.error.message } : null,
      } : null;
    });
    throw new Error('PlayerShell fMP4 fixture did not reach decoded frames: ' + JSON.stringify({
      state, mediaResponses, failedRequests, pageErrors: errors.slice(0, 8),
      cause: error instanceof Error ? error.message : String(error),
    }));
  }

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

  // Measure the real ArtPlayer timeline, then seek through its actual control.
  const timelineBefore = await page.evaluate(() => {
    const frame = document.querySelector('.netflix-player-frame');
    const video = frame?.querySelector('video');
    const progress = document.querySelector('.watch-cinema-progress');
    if (!video || !progress) {
      throw new Error('Custom cinema timeline/video is missing');
    }
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      duration: video.duration,
      currentTime: video.currentTime,
      progress: rect(progress),

      progressPointerEvents: getComputedStyle(progress).pointerEvents,
    };
  });
  if (timelineBefore.progress.height < 12 || timelineBefore.progress.height > 20) {
    throw new Error('Actual ArtPlayer seek hit area is outside 12–20px: ' + JSON.stringify(timelineBefore));
  }

  const seekTarget = await page.evaluate(() => {
    const progress = document.querySelector('.watch-cinema-progress');
    const video = document.querySelector('.netflix-player-frame video');
    if (!progress || !video) throw new Error('Cannot seek: progress control/video missing');
    const r = progress.getBoundingClientRect();
    return { x: r.left + r.width * 0.72, y: r.top + r.height / 2, before: video.currentTime };
  });
  await page.mouse.click(seekTarget.x, seekTarget.y);
  await page.waitForFunction((before) => {
    const video = document.querySelector('.netflix-player-frame video');
    return Boolean(video && Math.abs(video.currentTime - before) > 2);
  }, seekTarget.before, { timeout: 12_000 });
  const timelineAfter = await page.evaluate(() => ({
    currentTime: document.querySelector('.netflix-player-frame video')?.currentTime ?? 0,
  }));
  console.log('PASS custom cinema timeline geometry + pointer seek:', JSON.stringify({
    timelineBefore, seekTarget, timelineAfter,
  }));

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

  try {
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return Boolean(video && video === window.__pr84PlayerVideo &&
        window.__pr84SwitchEvents?.includes('loadstart') &&
        video.readyState >= 2 && video.currentTime >= 1.5 &&
        video.videoWidth > 0 && video.videoHeight > 0);
    }, null, { timeout: 60_000 });
  } catch (error) {
    const state = await page.evaluate(() => {
      const video = document.querySelector('video');
      return {
        sameVideoElement: video === window.__pr84PlayerVideo,
        locationSearch: window.location.search,
        switchEvents: window.__pr84SwitchEvents ?? [],
        currentSrc: video?.currentSrc ?? '',
        currentTime: video?.currentTime ?? 0,
        readyState: video?.readyState ?? 0,
        networkState: video?.networkState ?? 0,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        mediaError: video?.error ? { code: video.error.code, message: video.error.message } : null,
      };
    });
    throw new Error('AES-128 source-switch playback did not reach decoded frames: ' +
      JSON.stringify({ state, mediaResponses, failedRequests, pageErrors: errors.slice(0, 8), cause: error instanceof Error ? error.message : String(error) }));
  }

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

  const encodedKkphimUrl = process.env.PR84_KKPHIM_M3U8;
  if (encodedKkphimUrl) {
    const kkphimUrl = decodeURIComponent(encodedKkphimUrl);
    await page.evaluate((url) => {
      const video = document.querySelector('video');
      if (!video) throw new Error('PlayerShell video disappeared before KKPhim source switch');
      window.__pr84KkphimEvents = [];
      for (const name of ['emptied', 'loadstart', 'loadedmetadata', 'playing']) {
        video.addEventListener(name, () => window.__pr84KkphimEvents.push(name));
      }
      const next = new URL(window.location.href);
      next.searchParams.set('url', url);
      window.history.pushState({}, '', next.toString());
    }, kkphimUrl);

    try {
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return Boolean(video && video === window.__pr84PlayerVideo &&
          window.__pr84KkphimEvents?.includes('loadstart') &&
          video.readyState >= 2 && video.currentTime >= 1.5 &&
          video.videoWidth > 0 && video.videoHeight > 0);
      }, null, { timeout: 60_000 });
    } catch (error) {
      const state = await page.evaluate(() => {
        const video = document.querySelector('video');
        return {
          sameVideoElement: video === window.__pr84PlayerVideo,
          switchEvents: window.__pr84KkphimEvents ?? [],
          currentSrc: video?.currentSrc ?? '',
          currentTime: video?.currentTime ?? 0,
          readyState: video?.readyState ?? 0,
          networkState: video?.networkState ?? 0,
          videoWidth: video?.videoWidth ?? 0,
          videoHeight: video?.videoHeight ?? 0,
          mediaError: video?.error ? { code: video.error.code, message: video.error.message } : null,
        };
      });
      throw new Error('KKPhim HLS did not reach decoded frames in LibreTV PlayerShell: ' +
        JSON.stringify({ state, pageErrors: errors.slice(0, 8), cause: error instanceof Error ? error.message : String(error) }));
    }

    const third = await page.evaluate(() => {
      const video = document.querySelector('video');
      return {
        sameVideoElement: video === window.__pr84PlayerVideo,
        switchEvents: window.__pr84KkphimEvents,
        currentTime: video?.currentTime ?? 0,
        readyState: video?.readyState ?? 0,
        width: video?.videoWidth ?? 0,
        height: video?.videoHeight ?? 0,
        currentSrc: video?.currentSrc ?? '',
      };
    });
    if (!third.sameVideoElement) throw new Error('PlayerShell replaced the video element during KKPhim source switching');
    console.log('PASS LibreTV PlayerShell KKPhim HLS decoded playback:', JSON.stringify(third));
  }

  if (!process.env.PR84_KKPHIM_M3U8) {
    console.log('SKIP KKPhim PlayerShell decode: no freshly verified HLS candidate was produced by this run.');
  }

  if (errors.length > 0) throw new Error('Player console errors: ' + errors.slice(0, 8).join(' | '));

  await page.screenshot({ path: '/tmp/pr84-preview-player.png', fullPage: false });
  console.log('PASS LibreTV PlayerShell AES-128 source switch on the same video element:', JSON.stringify(second));
} finally {
  await browser.close();
}
