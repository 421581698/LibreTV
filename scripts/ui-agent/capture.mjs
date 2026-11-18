import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.UI_AGENT_BASE_URL ?? 'http://127.0.0.1:8080/';
const outputDir = process.env.UI_AGENT_OUTPUT_DIR ?? 'artifacts/ui-agent';
const strict = process.env.UI_AGENT_STRICT === '1';
const targets = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'ipad-11-portrait-834x1194', width: 834, height: 1194, ipad: true, expectedCinema: 'compact' },
  { name: 'ipad-11-landscape-1194x834', width: 1194, height: 834, ipad: true, expectedCinema: 'stage' },
  { name: 'ipad-pro-13-portrait-1032x1376', width: 1032, height: 1376, ipad: true, expectedCinema: 'stage' },
  { name: 'ipados-desktop-mode-1024x1366', width: 1024, height: 1366, ipadDesktopMode: true, expectedCinema: 'stage' },
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
        deviceScaleFactor: target.width < 600 || target.ipad ? 2 : 1,
        isMobile: Boolean(target.ipad),
        hasTouch: Boolean(target.ipad || target.ipadDesktopMode),
        userAgent: target.ipad
          ? 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
          : target.ipadDesktopMode
            ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
            : undefined,
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      if (target.ipadDesktopMode) {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
          Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
        });
      }
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
          ipadCinema: root?.getAttribute('data-ipad-cinema') ?? null,
          navOwner: root?.getAttribute('data-nav-owner') ?? null,
          navigator: { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints },
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
        expectedCinema: target.expectedCinema ?? null,
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
  (result.expectedCinema && (result.metrics?.ipadCinema !== result.expectedCinema || result.metrics?.navOwner !== 'adaptive')) ||
  result.pageErrors.length > 0
);
console.log(JSON.stringify({
  report: path.join(outputDir, 'report.json'),
  captures: results.length,
  detectedDefects: defects.length,
  strict,
}, null, 2));
if (strict && defects.length > 0) process.exitCode = 1;
