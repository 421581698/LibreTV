import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(process.env.FRIDAY_PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const candidate = process.env.FRIDAY_AUDIT_URL;
const baseline = process.env.FRIDAY_BASELINE_URL;
const mediaPath = process.env.FRIDAY_MEDIA_FIXTURE;
assert(candidate, 'Set FRIDAY_AUDIT_URL to the running LibreTV instance');

const browser = await chromium.launch({
  executablePath: process.env.FRIDAY_CHROMIUM || undefined,
});
const results = [];
const settings = [
  { width: 390, height: 844, prefix: '' },
  { width: 834, height: 1194, prefix: '/ipad-edition' },
  { width: 1194, height: 834, prefix: '/ipad-edition' },
  { width: 1440, height: 900, prefix: '' },
];

async function checkAppearance(viewport, colorScheme) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, colorScheme, reducedMotion: 'reduce' });
  try {
    await page.addInitScript(() => {
      window.fridayCLS = 0;
      if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.fridayCLS += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }
    });
    const url = new URL(viewport.prefix + '/settings', candidate);
    const response = await page.goto(url.href);
    assert(response?.ok(), `Could not load ${url.pathname} (HTTP ${response?.status()})`);
    try {
      await page.waitForFunction(() => document.documentElement.dataset.fridayGlass, undefined, { timeout: 15000 });
    } catch {
      // Worker and asset caches can warm independently immediately after deployment.
      url.searchParams.set('friday_audit_version', String(Date.now()));
      const retry = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      assert(retry?.ok(), `Could not reload ${url.pathname} (HTTP ${retry?.status()})`);
      await page.waitForFunction(() => document.documentElement.dataset.fridayGlass);
    }
    assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('dark')), colorScheme === 'dark');
    if (viewport.prefix) {
      const capsule = page.locator('.ipad-nav__topbar-inner');
      const button = capsule.locator('.ipad-nav__menu-button');
      assert.equal(await button.getAttribute('aria-expanded'), 'false');
      await button.click();
      const sidebar = page.locator('.ipad-nav__sidebar.is-open');
      await sidebar.waitFor();
      await sidebar.evaluate(async (element) => {
        const main = element.parentElement.querySelector('main');
        const prior = main.style.minHeight;
        try {
          main.style.minHeight = `${main.offsetHeight + 400}px`;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        } finally {
          main.style.minHeight = prior;
        }
      });
      assert.equal(await button.getAttribute('aria-expanded'), 'true', 'Content height changes must preserve the open sidebar');
      assert.equal(await capsule.locator('.friday-glass-selection').evaluate((el) => el.getAnimations().length), 0);
      await page.keyboard.press('Escape');
      await sidebar.waitFor({ state: 'hidden' });
    }
    await page.getByRole('button', { name: '外观模式' }).click();
    await page.getByRole('combobox', { name: '渲染质量' }).selectOption('safe');
    await page.waitForFunction(() => document.documentElement.dataset.fridayGlass === 'safe');
    await page.getByText('环境玻璃预览', { exact: true }).click();
    await page.getByRole('button', { name: colorScheme === 'dark' ? '海洋' : '冰雪' }).click();
    const material = page.locator('[data-friday-material="ambient"]');
    const contrast = await material.evaluate((element) => {
      const css = getComputedStyle(element);
      const rgb = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = (color) => rgb(color).map((v) => {
        const n = v / 255;
        return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
      }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const scores = [luminance(css.color), luminance(css.backgroundColor)].sort((a, b) => b - a);
      return (scores[0] + .05) / (scores[1] + .05);
    });
    const cls = await page.evaluate(() => window.fridayCLS);
    assert(contrast >= 4.5, `Solid ambient contrast fell below 4.5:1 (${contrast})`);
    assert(cls <= .1, `Settings CLS exceeded .1 (${cls})`);
    await page.reload();
    await page.getByRole('button', { name: '外观模式' }).click();
    assert.equal(await page.getByRole('combobox', { name: '渲染质量' }).inputValue(), 'safe');
    await page.getByRole('button', { name: '恢复玻璃默认设置' }).click();
    assert.equal(await page.getByRole('combobox', { name: '渲染质量' }).inputValue(), 'auto');
    results.push({ route: viewport.prefix + '/settings', width: viewport.width, colorScheme, contrast, cls });
  } finally {
    await page.close();
  }
}

async function checkMotion() {
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, reducedMotion: 'no-preference' });
  try {
    await page.goto(new URL('/ipad-edition/search', candidate).href);
    const capsule = page.locator('.ipad-nav__topbar-inner');
    const marker = capsule.locator('.friday-glass-selection');
    await marker.waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.fridayMotion === 'full');
    // Capture the animation before its short lifetime elapses, even on a busy runner.
    const motion = await capsule.evaluate((element) => new Promise((resolve) => {
      const highlight = element.querySelector('.friday-glass-selection');
      const intervals = [];
      let previous;
      const observe = (timestamp) => {
        animated ||= highlight.getAnimations().length === 1;
        if (previous !== undefined) intervals.push(timestamp - previous);
        previous = timestamp;
        if (intervals.length < 24) {
          requestAnimationFrame(observe);
          return;
        }
        intervals.sort((a, b) => a - b);
        resolve({ animated, medianFps: 1000 / intervals[12] });
      };
      element.querySelector('.ipad-nav__menu-button').click();
      let animated = false;
      requestAnimationFrame(observe);
    }));
    assert(motion.animated, 'Capsule selection did not animate');
    results.push({ route: '/ipad-edition/search', motion });
  } finally {
    await page.close();
  }
}

async function checkPlayback(url, body, verifyTouchSeek = false) {
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, hasTouch: true });
  try {
    const sourceUrl = 'https://preview.invalid/api.php/provide/vod';
    const mediaUrl = 'https://media.preview.invalid/friday-audit.webm';
    await page.route('**/api/status', (route) => route.fulfill({ json: {
      passwordRequired: false, verified: true, defaultSources: [], defaultLiveSources: [], defaultSubscriptions: [],
    } }));
    await page.route('**/api/detail?*', (route) => route.fulfill({ json: {
      episodes: [mediaUrl],
      episodeItems: [{ title: '玻璃性能样片', url: mediaUrl }],
      videoInfo: { title: '玻璃性能样片', sourceKey: 'friday-cms', sourceName: 'Preview Fixture', sourceUrl },
    } }));
    await page.route(mediaUrl, (route) => {
      const headers = { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
      if (!range) return route.fulfill({ contentType: 'video/webm', headers, body });
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      if (start > end) {
        return route.fulfill({ status: 416, headers: { ...headers, 'content-range': `bytes */${body.length}` } });
      }
      return route.fulfill({
        status: 206, contentType: 'video/webm',
        headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` },
        body: body.subarray(start, end + 1),
      });
    });
    const watch = new URL('/ipad-edition/watch', url);
    watch.search = new URLSearchParams({ source: 'friday-cms', id: 'ipad-preview-fixture', index: '0', title: '玻璃性能样片', sourceUrl });
    await page.goto(watch.href);
    const video = page.locator('.netflix-player-frame video').first();
    await video.waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('.netflix-player-frame video')?.readyState >= 2);
    await video.evaluate(async (element) => {
      element.muted = true;
      await element.play();
    });
    await page.waitForFunction(() => {
      const video = document.querySelector('.netflix-player-frame video');
      return video?.currentTime >= 4;
    });
    const playback = await video.evaluate((element) => {
      const { totalVideoFrames, droppedVideoFrames } = element.getVideoPlaybackQuality();
      return {
        decodedFrames: totalVideoFrames,
        droppedFrames: droppedVideoFrames,
        protected: document.documentElement.dataset.fridayPlayback === 'protected',
      };
    });
    assert(playback.decodedFrames > 0, 'Browser did not decode the media fixture');
    if (!verifyTouchSeek) return playback;
    await video.evaluate((element) => element.pause());
    const slider = page.getByRole('slider', { name: '播放进度' });
    await slider.scrollIntoViewIfNeeded();
    const bounds = await slider.boundingBox();
    const duration = await video.evaluate((element) => element.duration);
    const before = await video.evaluate((element) => element.currentTime);
    assert(bounds && Number.isFinite(duration), 'Seek surface or media duration is missing');
    const y = bounds.y + bounds.height / 2;
    const hit = await slider.evaluate((element, point) =>
      element.contains(document.elementFromPoint(point.x, point.y)),
    { x: bounds.x + bounds.width / 2, y });
    assert(hit, 'Another control intercepts the seek surface');
    const touch = await page.context().newCDPSession(page);
    const point = (fraction) => ({ x: bounds.x + bounds.width * fraction, y, id: 1 });
    try {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(.5)] });
      for (const fraction of [.56, .62, .68, .74, .8]) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(fraction)] });
      }
      const whileDragging = await video.evaluate((element) => element.currentTime);
      assert(Math.abs(whileDragging - before) < .2, 'Video seek must wait for touch release');
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction((expected) => {
        const video = document.querySelector('.netflix-player-frame video');
        return video && Math.abs(video.currentTime - expected) < .3 && !video.seeking;
      }, .8 * duration, { timeout: 5000 });
    } finally {
      await touch.detach();
    }
    return { ...playback, scrubBefore: before, scrubAfter: await video.evaluate((element) => element.currentTime) };
  } finally {
    await page.close();
  }
}


async function checkV12GlassLab() {
  const page = await browser.newPage({
    viewport: { width: 1194, height: 834 },
    reducedMotion: 'no-preference',
  });
  try {
    const response = await page.goto(new URL('/ipad-edition/glass-lab', candidate).href);
    assert(response?.ok(), 'Friday V1.2 Glass Lab did not load');
    const samples = page.locator('.liquid-glass[data-friday-material]').filter({ hasText: 'Friday · V1.2' });
    await samples.first().waitFor();
    assert.equal(await samples.count(), 6, 'Six material samples must be visible');
    const materials = await samples.evaluateAll(elements => elements.map(element => ({
      material: element.getAttribute('data-friday-material'),
      background: getComputedStyle(element).backgroundColor,
    })));
    assert.deepEqual(materials.map(item => item.material),
      ['regular', 'clear', 'frosted', 'cinema', 'ambient', 'solid']);
    assert.notEqual(materials[1].background, materials[2].background,
      'Clear and Frosted must have visibly distinct CSS fill');
    assert.notEqual(materials[0].background, materials[5].background,
      'Regular and Solid must not share the same fill');
    const difference = page.locator('output[data-refraction-pixel-difference]');
    await page.waitForFunction(() =>
      Number(document.querySelector('[data-refraction-pixel-difference]')
        ?.getAttribute('data-refraction-pixel-difference')) > 0);
    const enabledPixels = Number(await difference.getAttribute('data-refraction-pixel-difference'));
    await page.getByRole('button', { name: '关闭折射（对照原图）' }).click();
    await page.waitForFunction(() => document.querySelector('[data-refraction-pixel-difference]')
      ?.getAttribute('data-refraction-pixel-difference') === '0');
    await page.getByRole('button', { name: '开启折射' }).click();
    await page.waitForFunction(() =>
      Number(document.querySelector('[data-refraction-pixel-difference]')
        ?.getAttribute('data-refraction-pixel-difference')) > 0);
    await page.getByRole('combobox', { name: 'Friday 玻璃主题' }).selectOption('dark');
    await page.waitForFunction(() => document.documentElement.dataset.fridayTheme === 'dark');
    await page.getByRole('combobox', { name: 'Friday 玻璃主题' }).selectOption('light');
    await page.waitForFunction(() => document.documentElement.dataset.fridayTheme === 'light');
    await page.getByRole('combobox', { name: 'Friday 玻璃主题' }).selectOption('system');
    results.push({ route: '/ipad-edition/glass-lab', materials, enabledPixels, controlPixels: 0 });
  } finally {
    await page.close();
  }
}

try {
  for (const viewport of settings) {
    for (const scheme of ['light', 'dark']) {
      console.error(`Checking ${viewport.prefix || '/'} settings at ${viewport.width} × ${viewport.height} (${scheme})`);
      await checkAppearance(viewport, scheme);
    }
  }
  await checkMotion();
  await checkV12GlassLab();
  if (mediaPath) {
    const body = await fs.readFile(mediaPath);
    const test = await checkPlayback(candidate, body, true);
    assert(test.protected, 'The player did not enter the protected rendering mode');
    const reference = baseline ? await checkPlayback(baseline, body) : null;
    if (reference) {
      const ratio = ({ droppedFrames, decodedFrames }) => droppedFrames / decodedFrames;
      assert(ratio(test) <= ratio(reference) + .05, 'Dropped video-frame rate regressed by over five percentage points');
    }
    results.push({ route: '/ipad-edition/watch', media: 'controlled WebM fixture', test, baseline: reference });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
