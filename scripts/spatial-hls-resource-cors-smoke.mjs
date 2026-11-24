#!/usr/bin/env node
/**
 * Browser CORS matrix for the independently-owned spatial HLS resource graph.
 * Covers master manifest, variant playlist, media segment, AES-128 key and a
 * cross-origin redirect. This verifies browser readability of each resource;
 * it does not claim to decode or play the synthetic payloads.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const appOrigin = 'http://127.0.0.1:4173';
const cdnOrigin = 'http://127.0.0.1:4174';
const allowOrigin = { 'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Expose-Headers': 'Content-Length, Content-Range' };
const appServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><html><body>controlled CORS fixture</body></html>');
});
const cdnServer = createServer((request, response) => {
  const path = new URL(request.url ?? '/', cdnOrigin).pathname;
  if (path === '/master.m3u8') {
    response.writeHead(200, { ...allowOrigin, 'Content-Type': 'application/vnd.apple.mpegurl' });
    response.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nvariant/index.m3u8\n');
  } else if (path === '/variant/index.m3u8') {
    response.writeHead(200, { ...allowOrigin, 'Content-Type': 'application/vnd.apple.mpegurl' });
    response.end('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nsegment.ts\n#EXT-X-ENDLIST\n');
  } else if (path === '/variant/segment.ts') {
    response.writeHead(200, { ...allowOrigin, 'Content-Type': 'video/mp2t' });
    response.end(Buffer.from([0x47, 0x00, 0x00, 0x10]));
  } else if (path === '/keys/key.bin') {
    response.writeHead(200, { ...allowOrigin, 'Content-Type': 'application/octet-stream' });
    response.end(Buffer.alloc(16, 7));
  } else if (path === '/redirect/segment.ts') {
    response.writeHead(302, { ...allowOrigin, Location: cdnOrigin + '/final/segment.ts' });
    response.end();
  } else if (path === '/final/segment.ts') {
    response.writeHead(200, { ...allowOrigin, 'Content-Type': 'video/mp2t' });
    response.end(Buffer.from([0x47, 0x00, 0x00, 0x11]));
  } else if (path === '/denied/key.bin') {
    // Deliberately omit Access-Control-Allow-Origin: browser fetch must reject.
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.end(Buffer.alloc(16, 9));
  } else {
    response.writeHead(404);
    response.end('not found');
  }
});
const servers = [
  [appServer, 4173],
  [cdnServer, 4174],
];
const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const close = server => new Promise(resolve => server.close(() => resolve()));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = false;
try {
  await Promise.all(servers.map(([server, port]) => listen(server, port)));
  const page = await browser.newPage();
  const requestFailures = [];
  page.on('requestfailed', request => requestFailures.push({
    url: request.url(),
    failure: request.failure()?.errorText ?? 'unknown',
  }));
  await page.goto(appOrigin);
  const results = await page.evaluate(async ({ cdnOrigin }) => {
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
        checks.push({
          name,
          ok: response.ok && response.type !== 'opaque' && body.byteLength > 0,
          status: response.status,
          finalUrl: response.url,
          bytes: body.byteLength,
        });
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
  }, { cdnOrigin });
  for (const result of results) {
    console.log(JSON.stringify(result));
    if (!result.ok) failed = true;
  }
  if (results.filter(item => item.ok).length !== 6) failed = true;
  if (requestFailures.some(item => !item.url.includes('/denied/key.bin'))) {
    console.error('Unexpected browser request failures:', JSON.stringify(requestFailures));
    failed = true;
  }
  if (!requestFailures.some(item => item.url.includes('/denied/key.bin'))) {
    console.error('Expected denied key request to be blocked by browser CORS');
    failed = true;
  }
} catch (error) {
  failed = true;
  console.error('FAIL spatial HLS resource CORS smoke:', error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await browser.close();
  await Promise.all(servers.map(([server]) => close(server)));
}
if (failed) process.exitCode = 1;
