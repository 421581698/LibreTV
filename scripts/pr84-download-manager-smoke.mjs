#!/usr/bin/env node
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';

const base = process.env.PR84_PREVIEW_URL || 'https://libretv-pr84-preview.bggdbh.workers.dev';
const origin = new URL(base);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const output = '/tmp/pr84-download-acceptance.mp4';
const expected = Buffer.from(Array.from({ length: 128 * 1024 }, (_, i) => (i * 31 + 17) & 255));
const errors = [];

async function waitForTask(page, title, state) {
  await page.waitForFunction(({ title, state }) => {
    const titleNode = Array.from(document.querySelectorAll('p')).find((node) => node.textContent?.trim() === title);
    const card = titleNode?.closest('.card');
    const text = card?.textContent ?? '';
    return state === 'completed'
      ? text.includes('MP4') && text.includes('已完成')
      : text.includes('失败') && text.includes('HTTP 503') && Boolean(card?.querySelector('[role="alert"]'));
  }, { title, state }, { timeout: 30000 });
}

try {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));

  const successUrl = new URL('/__pr84__/download-fixture.mp4', origin).toString();
  const failureUrl = new URL('/__pr84__/download-failure.mp4', origin).toString();
  await page.route(successUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'video/mp4',
    headers: { 'content-length': String(expected.length), 'cache-control': 'no-store' },
    body: expected,
  }));
  await page.route(failureUrl, (route) => route.fulfill({
    status: 503,
    contentType: 'text/plain',
    body: 'deterministic PR84 download failure fixture',
  }));

  const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!response || response.status() !== 200) throw new Error('Preview homepage did not return HTTP 200');
  await page.evaluate(() => window.dispatchEvent(new Event('libretv:show-download-manager')));
  await page.waitForFunction(() => document.body.innerText.includes('下载管理'));

  const title = 'PR84 下载文件输出验收';
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(({ url, title }) => {
    window.dispatchEvent(new CustomEvent('libretv:add-download', { detail: { url, title, format: 'MP4' } }));
  }, { url: successUrl, title });
  const download = await downloadPromise;
  if (download.suggestedFilename() !== title + '.mp4') throw new Error('Unexpected filename: ' + download.suggestedFilename());
  await download.saveAs(output);
  const actual = await readFile(output);
  if (!actual.equals(expected)) throw new Error('Saved bytes did not match fixture');
  await waitForTask(page, title, 'completed');

  const successState = await page.evaluate((title) => {
    const titleNode = Array.from(document.querySelectorAll('p')).find((node) => node.textContent?.trim() === title);
    const card = titleNode?.closest('.card');
    return {
      text: card?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      progress: card?.querySelector('.h-1\\.5 > div')?.getAttribute('style') ?? null,
    };
  }, title);
  if (!successState.text.includes('已完成')) throw new Error('Task did not reach completed state');
  if (successState.progress && !successState.progress.includes('100%')) throw new Error('Progress bar did not reach 100%');
  console.log('PASS PR84 download file output', JSON.stringify({
    filename: download.suggestedFilename(),
    bytes: actual.length,
    sha256: createHash('sha256').update(actual).digest('hex'),
    task: successState,
  }));

  const failedTitle = 'PR84 下载失败反馈验收';
  await page.evaluate(({ url, title }) => {
    window.dispatchEvent(new CustomEvent('libretv:add-download', { detail: { url, title, format: 'MP4' } }));
  }, { url: failureUrl, title: failedTitle });
  await waitForTask(page, failedTitle, 'failed');
  const failureState = await page.evaluate((title) => {
    const titleNode = Array.from(document.querySelectorAll('p')).find((node) => node.textContent?.trim() === title);
    const card = titleNode?.closest('.card');
    return {
      text: card?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      alert: card?.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
    };
  }, failedTitle);
  if (!failureState.alert?.includes('HTTP 503')) throw new Error('HTTP 503 failure was not shown to the user');
  if (errors.length) throw new Error('Preview page errors: ' + errors.join(' | '));
  console.log('PASS PR84 download failure feedback', JSON.stringify(failureState));
} finally {
  await unlink(output).catch(() => undefined);
  await browser.close();
}
