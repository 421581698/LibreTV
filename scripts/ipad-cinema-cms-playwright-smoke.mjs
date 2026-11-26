#!/usr/bin/env node
/**
 * Preview-only Chromium UI integration, with mocked media and CMS sources.
 * NOT a physical iPad Safari or real-source playback acceptance test.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

const require = createRequire(process.env.RUNNER_TEMP + '/ipad-audit/package.json');
const { chromium } = require('playwright');
const base = 'https://libretv-ipad-edition-preview.bggdbh.workers.dev';
const provider = 'https://preview.invalid/api.php/provide/vod';
const episodes = [
  'https://media.preview.invalid/fixture-0.webm',
  'https://media.preview.invalid/fixture-1.webm',
];
const sample = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAI3EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggIh7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAn0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIFGPifZdEc9ecgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QdzWUA4JCwgRC6gRCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAzc3PWY8CLY8WIFGPifZdEc9dnyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMAAfQ7Z1+eeBAKOjgQAAgBACAJ0BKhAAEAAARwiFhYiZhIgCAgAMDWAA/v+rUICjmYEB9ACxAQABEBAAGAAwP/QMAAAA/v+rUICjmYED6ACxAQABEBAAGAAwP/QMAAAA/v+rUICjmYEF3ACxAQABEBAAGAAwP/QMAAAA/v+rUIAcU7trkbuPs4EAt4r3gQHxggGj8IED', 'base64');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let lookupCount = 0;
let notifySecondLookup;
const secondLookupStarted = new Promise(resolve => { notifySecondLookup = resolve; });
try {
  await page.route('**/api/status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      passwordRequired: false, verified: true, version: 'ipad-cms-gate-fixture',
      defaultSources: [], defaultLiveSources: [], defaultSubscriptions: [],
      defaultRecommendSource: null, defaultImageMode: 'direct',
    }),
  }));
  await page.route('**/api/detail?*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      episodes,
      episodeItems: episodes.map((url, index) => ({
        title: '第 ' + (index + 1) + ' 集', url, duration: '00:02',
      })),
      videoInfo: {
        title: 'Cinema CMS 绑定测试', typeName: '电视剧',
        sourceKey: 'friday-cms', sourceName: 'Preview Fixture', sourceUrl: provider,
      },
    }),
  }));
  await page.route('**/api/dolby-vision/cms-binding?*', async route => {
    lookupCount++;
    const index = new URL(route.request().url()).searchParams.get('episodeIndex');
    if (index === '1') {
      notifySecondLookup();
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    await route.fulfill({
      status: 404, contentType: 'application/json', body: '{"error":"unbound"}',
    }).catch(() => {});
  });
  await page.route('https://media.preview.invalid/**', route =>
    route.fulfill({ status: 200, contentType: 'video/webm', body: sample })
  );
  const params = new URLSearchParams({
    source: 'friday-cms', id: 'ipad-cms-gate-fixture', index: '0',
    title: 'Cinema CMS 绑定测试', sourceUrl: provider,
  });
  const response = await page.goto(base + '/ipad-edition/watch?' + params, {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });
  if (!response?.ok()) throw new Error('Cinema route HTTP ' + response?.status());
  await page.locator('.netflix-player-frame video').waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(() => {
    const video = document.querySelector('.netflix-player-frame video');
    if (!video) throw new Error('No mounted player video');
    video.dataset.cmsGateIdentity = 'original-video-element';
  });
  const legacySelectors = '.netflix-title-row, .netflix-watch-tools, .watch-cinema-rate';
  if (await page.locator(legacySelectors).count()) throw new Error('Legacy UI rendered inside Cinema');

  await page.getByRole('button', { name: '选集', exact: true }).click();
  await page.locator('.netflix-episode-list button').nth(1).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('index') === '1');
  await Promise.race([
    secondLookupStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Second CMS lookup not observed')), 10000)),
  ]);
  await page.waitForTimeout(150);
  const retainedDuringLookup = await page.evaluate(() =>
    document.querySelector('.netflix-player-frame video')?.dataset.cmsGateIdentity === 'original-video-element'
  );
  if (!retainedDuringLookup) throw new Error('Cinema unmounted video during CMS exact-binding lookup');
  await page.waitForTimeout(1450);
  const retainedAfterLookup = await page.evaluate(() =>
    document.querySelector('.netflix-player-frame video')?.dataset.cmsGateIdentity === 'original-video-element'
  );
  if (!retainedAfterLookup) throw new Error('Cinema replaced video after CMS lookup settled');
  if (await page.locator(legacySelectors).count()) throw new Error('Legacy UI returned after changing CMS episode');
  if (await page.locator('.cinema-v4-actions').count() !== 1) throw new Error('Cinema toolbar missing or duplicated');
  if (await page.getByTestId('cinema-native-fallback').count()) throw new Error('Unexpected native fallback');
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));

  await page.locator('.cinema-v4-source-control').evaluate(button => button.click());
  await page.getByRole('tab', { name: '详情' }).click();
  await page.locator('.cinema-v4-advanced-actions').waitFor({ state: 'visible', timeout: 10000 });
  const advanced = await page.locator('.cinema-v4-advanced-actions').evaluate(node => ({
    download: [...node.querySelectorAll('button')].some(button => button.textContent?.includes('下载本集')),
    skip: [...node.querySelectorAll('button')].some(button => button.textContent?.includes('跳过片段标记')),
    autoplay: Boolean(node.querySelector('input[type=checkbox]')),
  }));
  if (!Object.values(advanced).every(Boolean)) throw new Error('Advanced features missing: ' + JSON.stringify(advanced));
  await fs.mkdir('artifacts/ipad-visual-audit/cms-playback', { recursive: true });
  await page.screenshot({
    path: 'artifacts/ipad-visual-audit/cms-playback/cms-episode-switch.png',
    animations: 'disabled',
  });
  console.log(JSON.stringify({
    result: 'PASS', mode: 'synthetic Playwright Chromium',
    lookupCount, retainedDuringLookup, retainedAfterLookup,
    noLegacyUi: true, advanced, physicalIpadSafari: 'NOT TESTED',
  }));
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
