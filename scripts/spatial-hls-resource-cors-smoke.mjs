#!/usr/bin/env node
/**
 * Browser CORS matrix for the independently-owned spatial HLS resource graph.
 * Covers master manifest, variant playlist, media segment, AES-128 key and a
 * cross-origin redirect. This verifies browser readability of each resource;
 * it does not claim to decode or play the synthetic payloads.
 */
import { chromium } from 'playwright';

const appOrigin = 'http://127.0.0.1:4173';
const cdnOrigin = 'http://127.0.0.1:4174';
const redirectOrigin = 'http://localhost:4174';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = false;

try {
  const page = await browser.newPage();
  const requests = [];
  page.on('requestfailed', request => requests.push({
    url: request.url(),
    failure: request.failure()?.errorText ?? 'unknown',
  }));
  await page.route('http://127.0.0.1:4173/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body>controlled CORS fixture</body></html>',
  }));
  const readable = (body, contentType = 'application/octet-stream') => ({
    status: 200,
    contentType,
    body,
    headers: { 'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Expose-Headers': 'Content-Length, Content-Range' },
  });
  await page.route('http://127.0.0.1:4174/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/master.m3u8') return route.fulfill(readable('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nvariant/index.m3u8\n', 'application/vnd.apple.mpegurl'));
    if (path === '/variant/index.m3u8') return route.fulfill(readable('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nsegment.ts\n#EXT-X-ENDLIST\n', 'application/vnd.apple.mpegurl'));
    if (path === '/variant/segment.ts') return route.fulfill(readable(Buffer.from([0x47, 0x00, 0x00, 0x10])));
    if (path === '/keys/key.bin') return route.fulfill(readable(Buffer.alloc(16, 7)));
    if (path === '/redirect/segment.ts') return route.fulfill({
      status: 302,
      headers: { Location: redirectOrigin + '/final/segment.ts', 'Access-Control-Allow-Origin': appOrigin },
    });
    if (path === '/denied/key.bin') return route.fulfill({
      status: 200, contentType: 'application/octet-stream', body: Buffer.alloc(16, 9),
    });
    return route.fulfill({ status: 404, body: 'not found' });
  });
  await page.route('http://localhost:4174/**', route => route.fulfill(readable(Buffer.from([0x47, 0x00, 0x00, 0x11]))));
  await page.goto(appOrigin);
  const results = await page.evaluate(async ({ cdnOrigin, redirectOrigin }) => {
    const resources = [
      ['master manifest', cdnOrigin + '/master.m3u8'],
      ['variant playlist', cdnOrigin + '/variant/index.m3u8'],
      ['media segment', cdnOrigin + '/variant/segment.ts'],
      ['AES-128 key', cdnOrigin + '/keys/key.bin'],
      ['cross-origin redirect target', cdnOrigin + '/redirect/segment.ts'],
    ];
    const checks = [];
    for (const [name, url] of resources) {
      try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
        const body = await response.arrayBuffer();
        checks.push({ name, ok: response.ok && response.type !== 'opaque' && body.byteLength > 0, status: response.status, finalUrl: response.url, bytes: body.byteLength });
      } catch (error) {
        checks.push({ name, ok: false, error: String(error) });
      }
    }
    let deniedRejected = false;
    try {
      await fetch(cdnOrigin + '/denied/key.bin', { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    } catch {
      deniedRejected = true;
    }
    checks.push({ name: 'missing CORS header fails closed', ok: deniedRejected });
    return checks;
  }, { cdnOrigin, redirectOrigin });
  for (const result of results) {
    console.log(JSON.stringify(result));
    if (!result.ok) failed = true;
  }
  if (requests.length) {
    console.error('Browser request failures:', JSON.stringify(requests));
    // The deliberately denied key is expected to fail; all other failures are not.
    if (requests.some(item => !item.url.includes('/denied/key.bin'))) failed = true;
  }
  if (results.filter(item => item.ok).length !== 6) failed = true;
} catch (error) {
  failed = true;
  console.error('FAIL spatial HLS resource CORS smoke:', error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;
