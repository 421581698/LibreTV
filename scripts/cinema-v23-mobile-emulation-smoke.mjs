#!/usr/bin/env node
/**
 * Chromium mobile-viewport emulation only. This is not iPhone/iPad Safari device acceptance.
 * It exercises responsive layout, rotation-like viewport changes and split-view widths.
 */
import { chromium } from 'playwright';

const base = process.env.CINEMA_PREVIEW_URL || 'https://libretv-cinema-v23-preview.bggdbh.workers.dev';
const stream = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8';
const alternateStream = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/v9/prog_index.m3u8';
// Use the installed branded Chrome: Playwright's bundled Chromium may omit proprietary H.264/AAC codecs,
// which makes every HLS variant appear unsupported and invalidates playback acceptance.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const mediaCapabilities = await page.evaluate(() => {
  const mediaSource = window.MediaSource;
  const video = document.createElement('video');
  const codecs = [
    'video/mp4; codecs="avc1.64001e"',
    'audio/mp4; codecs="mp4a.40.2"',
    'video/mp4; codecs="avc1.64001e,mp4a.40.2"',
  ];
  return {
    userAgent: navigator.userAgent,
    mediaSourceAvailable: Boolean(mediaSource),
    mediaSourceTypeSupport: Object.fromEntries(codecs.map(codec => [codec, Boolean(mediaSource?.isTypeSupported(codec))])),
    canPlayType: Object.fromEntries(codecs.map(codec => [codec, video.canPlayType(codec)])),
  };
});
console.log('HLS browser codec preflight: ' + JSON.stringify(mediaCapabilities));
if (!mediaCapabilities.mediaSourceAvailable || !mediaCapabilities.mediaSourceTypeSupport['video/mp4; codecs="avc1.64001e,mp4a.40.2"']) {
  throw new Error('HLS acceptance browser lacks MSE AVC/AAC support; use the installed codec-enabled Chrome channel.');
}
page.setDefaultTimeout(15_000);
const errors = [];
const requestFailures = [];
const mediaRequests = [];
const mediaResponses = [];
const mediaResponseBodies = [];
const viewportFailures = [];
const safeUrl = (value) => {
  try { const parsed = new URL(value); return parsed.origin + parsed.pathname; }
  catch { return String(value).split('?')[0]; }
};
const isMediaRequest = (value) => /\.(m3u8|m4s|mp4|ts|aac|m4a)(?:$|[?#])/i.test(value) || /playlist|segment|manifest/i.test(value);
// Subscribe before navigation: HLS may attach and begin loading its master
// playlist before the video element is mounted in the DOM.
const hlsLifecycleEvents = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => {
  if (isMediaRequest(request.url())) mediaRequests.push({ url: safeUrl(request.url()), method: request.method(), resourceType: request.resourceType() });
});
page.on('response', response => {
  if (isMediaRequest(response.url())) {
    const headers = response.headers();
    mediaResponses.push({ url: safeUrl(response.url()), status: response.status(), contentType: headers['content-type'] ?? null, contentLength: headers['content-length'] ?? null, accessControlAllowOrigin: headers['access-control-allow-origin'] ?? null });
    if (/\.m3u8(?:$|[?#])/i.test(response.url())) {
      mediaResponseBodies.push(response.text().then(body => ({ url: safeUrl(response.url()), body: body.slice(0, 9000) })).catch(error => ({ url: safeUrl(response.url()), error: String(error) })));
    }
  }
});
page.on('requestfailed', request => requestFailures.push({ url: safeUrl(request.url()), error: request.failure()?.errorText ?? 'unknown' }));

try {
  const params = new URLSearchParams({
    // Match the already verified PlayerShell fixture identity so source resolution
    // and preview auth behavior are identical across desktop/mobile smoke runs.
    source: 'preview-smoke',
    sourceUrl: 'https://example.com/api.php/provide/vod',
    url: stream,
    title: 'Cinema V2.3 Mobile Emulation',
    cinemaDebug: '1',
  });
  await page.addInitScript(() => {
    window.__cinemaV23HlsEvents = [];
    window.addEventListener('libretv-cinema-hls-debug', event => {
      window.__cinemaV23HlsEvents.push({ ...event.detail, at: Math.round(performance.now()) });
    });
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
    window.__cinemaV23MediaEvents = [];
    for (const type of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled', 'suspend', 'abort', 'emptied', 'error']) {
      video.addEventListener(type, () => window.__cinemaV23MediaEvents.push({ type, at: Math.round(performance.now()), readyState: video.readyState, networkState: video.networkState, errorCode: video.error?.code ?? null }));
    }
    video.muted = true;
    void video.play().catch(error => window.__cinemaV23PlayError = String(error));
  });
  let mobileDecodeReady = true;
  try {
    await page.waitForFunction(() => {
      const video = document.querySelector('.netflix-player-frame video');
      return Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
    }, null, { timeout: 45_000 });
  } catch (error) {
    const mediaState = await page.evaluate(() => {
      const video = document.querySelector('.netflix-player-frame video');
      return {
        videoPresent: Boolean(video),
        readyState: video?.readyState ?? null,
        networkState: video?.networkState ?? null,
        paused: video?.paused ?? null,
        currentTime: video?.currentTime ?? null,
        duration: Number.isFinite(video?.duration) ? video.duration : null,
        videoWidth: video?.videoWidth ?? null,
        videoHeight: video?.videoHeight ?? null,
        currentSrc: video?.currentSrc ?? null,
        src: video?.getAttribute('src') ?? null,
        mediaError: video?.error ? { code: video.error.code, message: video.error.message } : null,
        playerText: document.querySelector('.netflix-player-frame')?.innerText.slice(0, 500) ?? '',
        playError: window.__cinemaV23PlayError ?? null,
        mediaEvents: window.__cinemaV23MediaEvents ?? [],
        hlsEvents: window.__cinemaV23HlsEvents ?? [],
        codecSupport: (() => {
          const video = document.createElement('video');
          const mediaSource = window.MediaSource;
          const candidates = [
            'video/mp4; codecs="avc1.640015"',
            'video/mp4; codecs="avc1.64001e"',
            'video/mp4; codecs="avc1.640020"',
            'video/mp4; codecs="avc1.64002a"',
            'audio/mp4; codecs="mp4a.40.2"',
            'audio/mp4; codecs="ac-3"',
            'audio/mp4; codecs="ec-3"',
          ];
          return {
            userAgent: navigator.userAgent,
            mediaSourceAvailable: Boolean(mediaSource),
            mediaSourceTypeSupport: Object.fromEntries(candidates.map(codec => [codec, Boolean(mediaSource?.isTypeSupported(codec))])),
            canPlayType: Object.fromEntries(candidates.map(codec => [codec, video.canPlayType(codec)])),
          };
        })(),
        resourceRequests: performance.getEntriesByType('resource')
          .map(entry => ({ name: entry.name.split('?')[0], initiatorType: entry.initiatorType, duration: Math.round(entry.duration), transferSize: entry.transferSize }))
          .filter(entry => /m3u8|m4s|mp4|ts|\.js/i.test(entry.name))
          .slice(-40),
      };
    });
    mobileDecodeReady = false;
    await page.screenshot({ path: '/tmp/cinema-v23-mobile-media-readiness-failure.png', fullPage: false });
    console.warn('DIAGNOSTIC mobile media did not reach decoded-frame readiness; continuing independent viewport checks: ' + JSON.stringify({
      mediaState,
      mediaRequests: mediaRequests.slice(-40),
      mediaResponses: mediaResponses.slice(-40),
      pageErrors: errors.slice(0, 12),
      requestFailures: requestFailures.slice(-20),
      cause: error instanceof Error ? error.message : String(error),
      hlsEvents: await page.evaluate(() => window.__cinemaV23HlsEvents ?? []),
    }));
  }

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
      const topbarRect = document.querySelector('.watch-topbar')?.getBoundingClientRect();
      const closeRect = document.querySelector('.cinema-close-control')?.getBoundingClientRect();
      const dock = document.querySelector('nav.v4-mobile-tabbar');
      const dockRect = dock?.getBoundingClientRect();
      const dockStyle = dock ? getComputedStyle(dock) : null;
      const dockVisible = Boolean(dock && dockStyle && dockStyle.display !== 'none' && dockStyle.visibility !== 'hidden' && Number.parseFloat(dockStyle.opacity || '1') > 0.05);
      const infoRect = document.querySelector('.watch-cinema-info')?.getBoundingClientRect();
      const synopsis = document.querySelector('.watch-cinema-copy');
      const safeProbe = document.createElement('div');
      safeProbe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
      document.body.appendChild(safeProbe);
      const safeStyle = getComputedStyle(safeProbe);
      const safeTop = parseFloat(safeStyle.paddingTop) || 0;
      const safeBottom = parseFloat(safeStyle.paddingBottom) || 0;
      safeProbe.remove();
      return {
        videoCount: document.querySelectorAll('video').length,
        sameVideoElement: video === window.__cinemaV23Video,
        viewportWidth: window.innerWidth,
        visualViewportHeight: window.visualViewport?.height ?? window.innerHeight,
        userAgent: navigator.userAgent,
        documentWidth: document.documentElement.scrollWidth,
        frameWidth: rect?.width ?? 0,
        frameHeight: rect?.height ?? 0,
        frameTop: rect?.top ?? 0,
        topbarBottom: topbarRect?.bottom ?? 0,
        closeBottom: closeRect?.bottom ?? 0,
        dockTop: dockRect?.top ?? 0,
        dockBottom: dockRect?.bottom ?? 0,
        dockVisible,
        infoPanel: infoRect ? { top: infoRect.top, bottom: infoRect.bottom, height: infoRect.height } : null,
        videoRectWidth: videoRect?.width ?? 0,
        videoRectHeight: videoRect?.height ?? 0,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        topbar: (() => {
          const r = document.querySelector('.watch-topbar')?.getBoundingClientRect();
          return r ? { top: r.top, bottom: r.bottom, height: r.height } : null;
        })(),
        closeButton: (() => {
          const r = document.querySelector('.cinema-close-control')?.getBoundingClientRect();
          return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
        })(),
        dock: (() => {
          const r = document.querySelector('nav.v4-mobile-tabbar')?.getBoundingClientRect();
          return r ? { top: r.top, bottom: r.bottom, height: r.height } : null;
        })(),
        synopsis: synopsis ? {
          textLength: synopsis.textContent?.trim().length ?? 0,
          clientHeight: synopsis.clientHeight,
          scrollHeight: synopsis.scrollHeight,
          overflowY: getComputedStyle(synopsis).overflowY,
          lineClamp: getComputedStyle(synopsis).webkitLineClamp,
        } : null,
        safeArea: { top: safeTop, bottom: safeBottom },
      };
    });
    const layoutIssues = [];
    if (layout.videoCount !== 1 || !layout.sameVideoElement || layout.frameWidth <= 0 || layout.frameHeight <= 0 ||
        layout.documentWidth > layout.viewportWidth + 2) {
      layoutIssues.push('base layout invariant');
    }
    if (profile.width <= 700) {
      // The cinema header is deliberately layered over the full-bleed player.
      // Validate its close affordance and safe-area bounds, not non-overlap with the video frame.
      if (!layout.closeButton || layout.closeButton.top < layout.safeArea.top - 1 ||
          layout.closeButton.left < 0 || layout.closeButton.right > profile.width ||
          layout.closeButton.bottom > profile.height) {
        layoutIssues.push('close control is outside the safe viewport');
      }
      if (layout.dockVisible) {
        layoutIssues.push('app dock remains visible over the immersive player');
      }
      if (!layout.infoPanel || layout.infoPanel.bottom > profile.height - layout.safeArea.bottom + 2) {
        layoutIssues.push('cinema information panel overlaps the bottom safe area');
      }
    }
    if (layout.synopsis && (layout.synopsis.overflowY === 'hidden' || layout.synopsis.overflowY === 'clip') &&
        layout.synopsis.scrollHeight > layout.synopsis.clientHeight + 1) {
      layoutIssues.push('synopsis content is clipped');
    }
    if (layoutIssues.length) viewportFailures.push({ profile: profile.name, issues: layoutIssues, layout });

    try {
      await page.mouse.move(Math.min(profile.width - 10, Math.round(profile.width / 2)), Math.round(profile.height / 2));
      const subtitleButton = page.locator('button[aria-label="字幕设置"]');
      await subtitleButton.waitFor({ state: 'visible', timeout: 5_000 });
      await subtitleButton.click();
      await page.locator('select[aria-label="选择字幕轨"]').waitFor({ state: 'visible', timeout: 3_000 });
      // Subtitle source ownership is remote-resource driven. This layout smoke
      // test checks the controls only; it must not inject a local ASS fixture.
      await subtitleButton.click();

      const spatialButton = page.locator('button[aria-label="空间音频设置"]');
      await spatialButton.waitFor({ state: 'visible', timeout: 5_000 });
      await spatialButton.click();
      await page.getByText('空间音频', { exact: true }).waitFor({ state: 'visible', timeout: 3_000 });
      await spatialButton.click();
    } catch (error) {
      viewportFailures.push({ profile: profile.name, controlError: error instanceof Error ? error.message : String(error) });
    }

    await page.screenshot({ path: profile.screenshot, fullPage: false });
    console.log((layoutIssues.length ? 'DIAGNOSTIC ' : 'PASS ') + profile.name + ': ' + JSON.stringify({ layoutIssues, layout }));
  }

  if (mobileDecodeReady) {
    const previousMediaSrc = await page.evaluate((url) => {
      const video = document.querySelector('.netflix-player-frame video');
      if (!video) throw new Error('Video missing before resource source switch.');
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
  
  
  } else {
    console.warn('FAIL mobile playback acceptance: initial media never reached decoded-frame readiness; source-switch acceptance is blocked.');
    viewportFailures.push({ mobilePlayback: 'Initial HLS source did not decode a frame; inspect HLS lifecycle, codec capability and media requests.' });
  }
  const playlistBodies = await Promise.all(mediaResponseBodies);
  console.log('Mobile media request summary: ' + JSON.stringify({ requests: mediaRequests, responses: mediaResponses, failures: requestFailures, playlists: playlistBodies }));
  if (errors.length) viewportFailures.push({ pageErrors: errors.slice(0, 8) });
  if (viewportFailures.length) throw new Error('Mobile viewport acceptance issues: ' + JSON.stringify(viewportFailures));
  console.log('PASS Chromium responsive/rotation/split-width layout emulation. Decode-dependent source switching is reported separately; physical Safari testing remains required.');
} finally {
  await browser.close();
}
