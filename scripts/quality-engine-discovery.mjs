#!/usr/bin/env node
/**
 * Read-only browser discovery for LibreTV Quality Engine.
 * It observes same-origin routes and interactive affordances; it never clicks,
 * submits forms, mutates settings, or claims physical-device acceptance.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.QUALITY_BASE_URL || 'http://127.0.0.1:8080';
const artifactDir = resolve(process.env.QUALITY_ARTIFACT_DIR || 'artifacts/quality-engine');
const maxRoutes = Math.max(1, Math.min(20, Number(process.env.QUALITY_DISCOVERY_MAX_ROUTES) || 12));
const excluded = ['/api', '/_next', '/assets', '/.well-known', '/favicon'];
const seedRoutes = ['/', '/search', '/settings', '/me'];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseURL,
  commitSha: process.env.GITHUB_SHA || null,
  branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null,
  mode: 'read-only-browser-discovery',
  routes: [],
  findings: [],
  limitations: [
    'Discovery is observational and does not click controls or submit forms.',
    'Dynamic identifier routes and query-string variants are excluded.',
    'Chromium results do not represent physical iPhone or iPad Safari acceptance.',
    'No LLM is connected in this deterministic discovery pass.',
  ],
};

const origin = new URL(baseURL).origin;
const queue = [...seedRoutes];
const queued = new Set(queue);
const visited = new Set();
let browser;

function safePath(pathname) {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return false;
  if (excluded.some((prefix) => pathname.startsWith(prefix))) return false;
  if (pathname.split('/').some((segment) => segment.startsWith(':') || /^\\d{5,}$/.test(segment) || /^[a-f0-9]{16,}$/i.test(segment))) return false;
  return true;
}

try {
  await mkdir(artifactDir, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });

  while (queue.length && visited.size < maxRoutes) {
    const route = queue.shift();
    if (visited.has(route)) continue;
    visited.add(route);
    const page = await context.newPage();
    const routeEntry = { path: route, status: 'failed', controls: [], links: [], errors: [] };

    page.on('pageerror', (error) => routeEntry.errors.push({ kind: 'pageerror', message: error.message.slice(0, 240) }));
    page.on('console', (message) => {
      if (message.type() === 'error') routeEntry.errors.push({ kind: 'console', message: message.text().slice(0, 240) });
    });
    page.on('requestfailed', (request) => {
      routeEntry.errors.push({ kind: 'requestfailed', url: request.url().slice(0, 300), message: request.failure()?.errorText || 'request failed' });
    });
    page.on('response', (response) => {
      if (response.status() >= 500) routeEntry.errors.push({ kind: 'http', status: response.status(), url: response.url().slice(0, 300) });
    });

    try {
      const response = await page.goto(new URL(route, baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      routeEntry.httpStatus = response?.status() ?? null;
      await page.waitForTimeout(350);
      const observed = await page.evaluate(() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
        const controls = [...document.querySelectorAll('button, input, textarea, select, [role="button"], [role="link"], [role="tab"]')]
          .slice(0, 100)
          .map((node) => ({
            tag: node.tagName.toLowerCase(),
            type: node.getAttribute('type'),
            role: node.getAttribute('role'),
            label: clean(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.getAttribute('placeholder') || node.getAttribute('name')),
            disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
          }));
        const links = [...document.querySelectorAll('a[href]')]
          .map((node) => node.href)
          .filter(Boolean);
        return {
          title: clean(document.title),
          headings: [...document.querySelectorAll('h1,h2')].slice(0, 12).map((node) => clean(node.innerText)).filter(Boolean),
          landmarks: ['main', 'nav', 'header', 'footer'].filter((selector) => document.querySelector(selector)),
          controls,
          links,
        };
      });

      routeEntry.status = response?.ok() ? 'observed' : 'http-error';
      routeEntry.title = observed.title;
      routeEntry.headings = observed.headings;
      routeEntry.landmarks = observed.landmarks;
      routeEntry.controls = observed.controls;
      routeEntry.links = observed.links.length;

      for (const href of observed.links) {
        try {
          const url = new URL(href);
          const path = url.pathname;
          if (url.origin === origin && safePath(path) && !queued.has(path) && !visited.has(path) && queue.length + visited.size < maxRoutes) {
            queued.add(path);
            queue.push(path);
          }
        } catch {
          // Ignore malformed and non-URL anchors; discovery remains read-only.
        }
      }

      if (!observed.landmarks.includes('main')) {
        report.findings.push({ id: `route-main-${route}`, area: 'navigation', risk: 'medium', title: 'Route has no main landmark', route, evidence: ['DOM inspection'] });
      }
      if (routeEntry.errors.length) {
        report.findings.push({ id: `route-errors-${route}`, area: 'runtime', risk: 'medium', title: 'Route emitted browser or network errors', route, evidence: routeEntry.errors.slice(0, 8).map((item) => JSON.stringify(item)) });
      }
    } catch (error) {
      routeEntry.error = error instanceof Error ? error.message : String(error);
      report.findings.push({ id: `route-load-${route}`, area: 'navigation', risk: 'high', title: 'Route could not be observed', route, evidence: [routeEntry.error] });
    } finally {
      report.routes.push(routeEntry);
      await page.close();
    }
  }

  await context.close();
  report.completed = true;
} catch (error) {
  report.completed = false;
  report.runnerError = error instanceof Error ? error.stack || error.message : String(error);
  console.error(report.runnerError);
} finally {
  if (browser) await browser.close();
  report.summary = {
    routesVisited: report.routes.length,
    observed: report.routes.filter((route) => route.status === 'observed').length,
    routeErrors: report.routes.filter((route) => route.status !== 'observed').length,
    findings: report.findings.length,
    physicalDeviceAcceptance: 'not-performed',
    aiProviderConnected: false,
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(resolve(artifactDir, 'quality-engine-discovery.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
}

if (!report.completed) process.exitCode = 1;
