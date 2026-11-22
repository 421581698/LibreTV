#!/usr/bin/env node
/**
 * Friday Liquid Glass Phase 3 browser smoke.
 * Mobile scenarios are Chromium viewport emulation, never physical Safari acceptance.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.QUALITY_BASE_URL || 'http://127.0.0.1:8080';
const artifactDir = resolve(process.env.QUALITY_ARTIFACT_DIR || 'artifacts/friday-liquid-glass');
const routes = ['/', '/settings', '/me', '/live', '/detail', '/watch'];
const scenarios = [
  { name: 'desktop', viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 },
  { name: 'iphone-viewport-emulation', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'ipad-viewport-emulation', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

await mkdir(artifactDir, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  note: 'iPhone/iPad scenarios are Chromium viewport emulation only. Physical Safari acceptance is not performed by this workflow.',
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
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const entry = { name: scenario.name, viewport: scenario.viewport, status: 'passed', routes: [] };
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    for (const route of routes) {
      const result = { route, status: 'passed', checks: [] };
      try {
        const response = await page.goto(new URL(route, baseURL).toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
        if (!response) throw new Error('Navigation returned no HTTP response');
        if (!response.ok()) throw new Error(`${route} returned HTTP ${response.status()}`);
        await page.locator('main').first().waitFor({ state: 'visible', timeout: 20_000 });
        result.checks.push('http-ok', 'main-landmark-visible');

        const state = await page.evaluate(() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          glassSurfaceCount: document.querySelectorAll('.friday-glass').length,
          videoInsideGlass: document.querySelectorAll('.friday-glass video').length,
          title: document.title,
        }));
        result.state = state;
        if (state.documentWidth > state.viewportWidth + 1) {
          throw new Error(`Horizontal overflow on ${route}: ${state.documentWidth}px > ${state.viewportWidth}px`);
        }
        result.checks.push('no-horizontal-overflow');

        if (['/settings', '/me', '/live'].includes(route) && state.glassSurfaceCount === 0) {
          throw new Error(`Expected Friday glass surfaces were not found on ${route}`);
        }
        if (['/settings', '/me', '/live'].includes(route)) result.checks.push('friday-glass-surface-present');

        if (state.videoInsideGlass > 0) {
          throw new Error(`Video element was nested inside a glass surface on ${route}`);
        }
        result.checks.push('video-not-wrapped-by-glass');

        if (pageErrors.length) throw new Error(`Uncaught browser errors: ${pageErrors.join(' | ')}`);
        result.checks.push('no-uncaught-page-errors');
      } catch (error) {
        result.status = 'failed';
        result.error = error instanceof Error ? error.stack || error.message : String(error);
        entry.status = 'failed';
      } finally {
        const screenshot = resolve(artifactDir, `${scenario.name}-${route === '/' ? 'home' : route.slice(1)}.png`);
        try {
          await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
          result.screenshot = screenshot;
        } catch (error) {
          result.screenshotError = error instanceof Error ? error.message : String(error);
        }
        entry.routes.push(result);
      }
    }
    report.scenarios.push(entry);
    await context.close();
    console.log(`${entry.status.toUpperCase()} ${entry.name}`);
  }
} catch (error) {
  report.runnerError = error instanceof Error ? error.stack || error.message : String(error);
  console.error(report.runnerError);
} finally {
  if (browser) await browser.close();
  report.summary = {
    scenarios: report.scenarios.length,
    routes: report.scenarios.reduce((sum, item) => sum + item.routes.length, 0),
    failedRoutes: report.scenarios.reduce((sum, item) => sum + item.routes.filter((route) => route.status !== 'passed').length, 0),
    physicalSafariAcceptance: 'not-performed',
  };
  await writeFile(resolve(artifactDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
}
if (report.runnerError || report.summary.failedRoutes > 0) process.exitCode = 1;
