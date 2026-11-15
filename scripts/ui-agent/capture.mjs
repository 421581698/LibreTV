import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.UI_AGENT_BASE_URL ?? 'http://127.0.0.1:8080/';
const outputDir = process.env.UI_AGENT_OUTPUT_DIR ?? 'artifacts/ui-agent';
const strict = process.env.UI_AGENT_STRICT === '1';
const targets = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'tablet-1024x1366', width: 1024, height: 1366 },
  { name: 'phone-390x844', width: 390, height: 844 },
  { name: 'phone-375x812', width: 375, height: 812 },
];
const themes = ['light', 'dark'];
const results = [];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  for (const target of targets) {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: target.width, height: target.height },
        deviceScaleFactor: target.width < 600 ? 2 : 1,
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];

      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('requestfailed', (request) => {
        failedRequests.push({
          url: request.url(),
          error: request.failure()?.errorText ?? 'unknown',
        });
      });

      let navigationError = null;
      try {
        await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 45000 });
      } catch (error) {
        navigationError = error.message;
      }

      const metrics = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        const viewportWidth = window.innerWidth;
        const documentWidth = Math.max(root?.scrollWidth ?? 0, body?.scrollWidth ?? 0);
        const viewportHeight = window.innerHeight;
        const documentHeight = Math.max(root?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
        return {
          title: document.title,
          viewport: { width: viewportWidth, height: viewportHeight },
          document: { width: documentWidth, height: documentHeight },
          horizontalOverflow: documentWidth > viewportWidth + 1,
          bodyBackground: getComputedStyle(body).backgroundColor,
          rootBackground: getComputedStyle(root).backgroundColor,
          fixedElements: [...document.querySelectorAll('*')]
            .filter((element) => getComputedStyle(element).position === 'fixed')
            .slice(0, 30)
            .map((element) => ({
              tag: element.tagName.toLowerCase(),
              id: element.id || null,
              className: typeof element.className === 'string' ? element.className.slice(0, 120) : null,
              rect: (() => {
                const rect = element.getBoundingClientRect();
                return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
              })(),
            })),
        };
      }).catch((error) => ({ evaluationError: error.message }));

      const screenshot = path.join(outputDir, `${target.name}-${theme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' }).catch(() => {});
      results.push({
        target: target.name,
        theme,
        url: page.url(),
        navigationError,
        metrics,
        consoleErrors,
        pageErrors,
        failedRequests,
        screenshot,
      });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  evidenceClass: 'BROWSER',
  note: 'Chromium automation is not physical iPhone/iPad Safari acceptance.',
  results,
};
await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
const defects = results.filter((result) =>
  result.navigationError ||
  result.metrics?.horizontalOverflow ||
  result.pageErrors.length > 0
);
console.log(JSON.stringify({
  report: path.join(outputDir, 'report.json'),
  captures: results.length,
  detectedDefects: defects.length,
  strict,
}, null, 2));
if (strict && defects.length > 0) process.exitCode = 1;
