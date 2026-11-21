#!/usr/bin/env node
/**
 * LibreTV Quality Engine browser smoke.
 * Desktop + responsive viewport emulation only; never reports physical iPhone/iPad acceptance.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.QUALITY_BASE_URL || 'http://127.0.0.1:8080';
const artifactDir = resolve(process.env.QUALITY_ARTIFACT_DIR || 'artifacts/quality-engine');
const scenarios = [
  { name: 'desktop-chromium', viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 },
  { name: 'iphone-viewport-emulation', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'ipad-viewport-emulation', viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

await mkdir(artifactDir, { recursive: true });
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseURL,
  note: 'Mobile viewport scenarios are Chromium emulation, not physical iPhone/iPad Safari acceptance.',
  scenarios: [],
};
let browser;

try {
  browser = await chromium.launch({ headless: true });
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      deviceScaleFactor: scenario.deviceScaleFactor,
      isMobile: Boolean(scenario.isMobile),
      hasTouch: Boolean(scenario.hasTouch),
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const entry = {
      name: scenario.name,
      viewport: scenario.viewport,
      status: 'failed',
      checks: [],
      pageErrors,
    };

    try {
      const response = await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (!response) throw new Error('Navigation returned no HTTP response');
      entry.httpStatus = response.status();
      if (!response.ok()) throw new Error(`Homepage returned HTTP ${response.status()}`);

      await page.locator('main').first().waitFor({ state: 'visible', timeout: 20_000 });
      entry.checks.push({ name: 'homepage-http', status: 'passed', detail: response.status() });
      entry.checks.push({ name: 'main-landmark-visible', status: 'passed' });

      const pageState = await page.evaluate(() => ({
        title: document.title,
        bodyTextLength: document.body?.innerText?.trim().length ?? 0,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        hasMain: Boolean(document.querySelector('main')),
      }));
      entry.pageState = pageState;
      if (!pageState.title) throw new Error('Document title is empty');
      if (!pageState.bodyTextLength) throw new Error('Homepage body is empty');
      if (pageState.documentWidth > pageState.viewportWidth) {
        throw new Error(`Horizontal overflow: document ${pageState.documentWidth}px > viewport ${pageState.viewportWidth}px`);
      }
      entry.checks.push({ name: 'document-title-and-content', status: 'passed' });
      entry.checks.push({ name: 'no-horizontal-overflow', status: 'passed' });

      if (pageErrors.length) throw new Error(`Uncaught page errors: ${pageErrors.join(' | ')}`);
      entry.checks.push({ name: 'uncaught-page-errors', status: 'passed' });

      // Deterministic user journeys: empty search, category shortcut and query submission.
      await page.goto(new URL('/search', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      let searchInput = page.getByRole('textbox', { name: '搜索影视内容' });
      await searchInput.waitFor({ state: 'visible', timeout: 15_000 });
      await searchInput.fill('');
      await searchInput.press('Enter');
      if (!page.url().includes('/search')) throw new Error('Empty search unexpectedly navigated');
      entry.checks.push({ name: 'empty-search-stays-on-search-page', status: 'passed' });

      const categoryButton = page.getByRole('button', { name: '科幻', exact: true });
      await categoryButton.waitFor({ state: 'visible', timeout: 10_000 });
      await categoryButton.click();
      await page.waitForURL((url) => url.pathname === '/search/results' && url.searchParams.get('q') === '科幻电影', { timeout: 15_000 });
      entry.checks.push({ name: 'category-shortcut-submits-intended-query', status: 'passed' });

      await page.goto(new URL('/search', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      searchInput = page.getByRole('textbox', { name: '搜索影视内容' });
      await searchInput.waitFor({ state: 'visible', timeout: 15_000 });
      const query = 'LibreTV QA smoke';
      await searchInput.fill(query);
      await searchInput.press('Enter');
      await page.waitForURL((url) => url.pathname === '/search/results' && url.searchParams.get('q') === query, { timeout: 15_000 });
      await page.locator('main').first().waitFor({ state: 'visible', timeout: 15_000 });
      entry.checks.push({ name: 'search-submits-query-to-results-route', status: 'passed', detail: page.url() });

      // Safe route smoke for core navigation and incomplete watch URLs.
      for (const route of ['/settings', '/me', '/live', '/watch']) {
        const routeResponse = await page.goto(new URL(route, baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
        if (!routeResponse?.ok()) throw new Error(`${route} returned HTTP ${routeResponse?.status() ?? 'no response'}`);
        await page.locator('main').first().waitFor({ state: 'visible', timeout: 15_000 });
        if (pageErrors.length) throw new Error(`Uncaught page errors on ${route}: ${pageErrors.join(' | ')}`);
        entry.checks.push({ name: `route-${route.slice(1)}-loads-safely`, status: 'passed', detail: routeResponse.status() });
      }

      entry.status = 'passed';
    } catch (error) {
      entry.error = error instanceof Error ? error.stack || error.message : String(error);
    } finally {
      const screenshotPath = resolve(artifactDir, `${scenario.name}.png`);
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
        entry.screenshot = screenshotPath;
      } catch (error) {
        entry.screenshotError = error instanceof Error ? error.message : String(error);
      }
      await context.close();
    }

    report.scenarios.push(entry);
    console.log(`${entry.status.toUpperCase()} ${entry.name}${entry.error ? `: ${entry.error.split('\\n')[0]}` : ''}`);
  }
} catch (error) {
  report.runnerError = error instanceof Error ? error.stack || error.message : String(error);
  console.error(report.runnerError);
} finally {
  if (browser) await browser.close();
  report.summary = {
    total: report.scenarios.length,
    passed: report.scenarios.filter((item) => item.status === 'passed').length,
    failed: report.scenarios.filter((item) => item.status !== 'passed').length,
    physicalDeviceAcceptance: 'not-performed',
  };
  await writeFile(resolve(artifactDir, 'quality-engine-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
}

if (report.runnerError || report.summary.failed > 0) process.exitCode = 1;
