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
    await page.goto(new URL(viewport.prefix + '/settings', candidate).href);
    await page.waitForFunction(() => document.documentElement.dataset.fridayGlass);
    assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('dark')), colorScheme === 'dark');
    if (viewport.prefix) {
      const capsule = page.locator('.ipad-nav__topbar-inner');
      const button = capsule.locator('.ipad-nav__menu-button');
      assert.equal(await button.getAttribute('aria-expanded'), 'false');
      await button.click();
      const sidebar = page.locator('.ipad-nav__sidebar.is-open');
      await sidebar.waitFor();
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
      requestAnimationFrame(() => {
        animated = highlight.getAnimations().length === 1;
        requestAnimationFrame(observe);
      });
    }));
    assert(motion.animated, 'Capsule selection did not animate');
    results.push({ route: '/ipad-edition/search', motion });
  } finally {
    await page.close();
  }
}

async function checkPlayback(url, body) {
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
    await page.route(mediaUrl, (route) => route.fulfill({ contentType: 'video/webm', body }));
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
    return playback;
  } finally {
    await page.close();
  }
}

try {
  for (const viewport of settings) {
    for (const scheme of ['light', 'dark']) await checkAppearance(viewport, scheme);
  }
  await checkMotion();
  if (mediaPath) {
    const body = await fs.readFile(mediaPath);
    const test = await checkPlayback(candidate, body);
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
