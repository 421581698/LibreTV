#!/usr/bin/env node
/**
 * Browser integration smoke for the manual DASH connection form.
 * Verifies the real /connect UI hands the signed media URL through tab-scoped
 * sessionStorage rather than exposing it in the /watch URL.
 */
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const manifestUrl = 'https://media.example.test/private/manifest.mpd?signature=ci-secret';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(baseUrl + '/connect', { waitUntil: 'networkidle' });
  await page.getByLabel('DASH MPD 地址').fill(manifestUrl);
  await page.getByLabel('影片名称（可选）').fill('DASH 集成测试');
  await page.getByRole('button', { name: '验证地址并进入播放器' }).click();
  await page.waitForURL(/\/watch\?/);

  const result = await page.evaluate(() => {
    const params = new URLSearchParams(window.location.search);
    const stored = sessionStorage.getItem('libretv:manual-playback');
    return {
      path: window.location.pathname,
      query: window.location.search,
      source: params.get('source'),
      mediaType: params.get('mediaType'),
      title: params.get('title'),
      stored: stored ? JSON.parse(stored) : null,
    };
  });
  if (result.path !== '/watch' || result.source !== 'manual-input' || result.mediaType !== 'dash') {
    throw new Error('Unexpected watch navigation: ' + JSON.stringify(result));
  }
  if (result.query.includes('signature=') || result.query.includes(encodeURIComponent(manifestUrl))) {
    throw new Error('Signed media URL leaked into browser URL: ' + result.query);
  }
  if (result.stored?.url !== manifestUrl || result.stored?.mediaType !== 'dash') {
    throw new Error('Tab-scoped playback handoff missing or incorrect: ' + JSON.stringify(result.stored));
  }
  if (result.title !== 'DASH 集成测试') throw new Error('Playback title was not preserved');
  console.log('PASS /connect form navigation and sessionStorage handoff:', JSON.stringify({
    path: result.path, source: result.source, mediaType: result.mediaType,
    title: result.title, urlAbsentFromQuery: !result.query.includes('signature='),
  }));
  await context.close();
} finally {
  await browser.close();
}
