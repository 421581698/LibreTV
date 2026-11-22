#!/usr/bin/env node
/**
 * Real-browser DASH smoke test against Shaka Project's published DASH demo asset.
 * Verifies MPD parsing, segment fetch, decode, timeline progress, seeking and teardown.
 * This validates the DASH engine, not a physical iPhone/iPad Safari session.
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const manifest = 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd';
const timeoutMs = 60_000;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
let failed = false;

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(timeoutMs);
  page.on('requestfailed', (request) => {
    console.error('DASH request failed:', request.url(), request.failure()?.errorText);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) console.error('DASH HTTP error:', response.status(), response.url());
  });
  await page.setContent('<!doctype html><html><body style="margin:0;background:#000"><video id="video" muted playsinline controls style="width:960px;height:540px"></video></body></html>');
  await page.addScriptTag({ path: resolve('node_modules/shaka-player/dist/shaka-player.compiled.js') });

  const result = await page.evaluate(async (url) => {
    const shakaRuntime = window.shaka;
    if (!shakaRuntime) throw new Error('Shaka Player bundle did not expose window.shaka');
    shakaRuntime.polyfill.installAll();
    if (!shakaRuntime.Player.isBrowserSupported()) throw new Error('Browser does not support Shaka Player requirements');

    const video = document.querySelector('#video');
    if (!(video instanceof HTMLVideoElement)) throw new Error('Test video element is missing');
    const player = new shakaRuntime.Player(video);
    const errors = [];
    player.addEventListener('error', (event) => errors.push(event.detail?.code ?? 'unknown'));
    await player.load(url);
    await video.play();

    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        if (predicate()) return;
        if (errors.length) throw new Error(label + ' failed with Shaka error: ' + errors.join(','));
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(label + ' timed out; currentTime=' + video.currentTime + ', readyState=' + video.readyState);
    };

    await waitFor(() => !video.paused && video.readyState >= 2 && video.currentTime > 2, 'DASH decode/progress');
    const decoded = { currentTime: video.currentTime, width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    if (decoded.width <= 0 || decoded.height <= 0) throw new Error('DASH decoded frame has no dimensions');

    video.pause();
    const seekTarget = Math.min(8, Math.max(3, decoded.duration / 2));
    video.currentTime = seekTarget;
    await waitFor(() => Math.abs(video.currentTime - seekTarget) < 1.5 && video.readyState >= 2, 'DASH seek');
    const seekPosition = video.currentTime;
    await player.destroy();
    return { ...decoded, seekPosition };
  }, manifest);

  if (result.width <= 0 || result.height <= 0 || result.currentTime <= 2) {
    throw new Error('DASH smoke returned invalid decode evidence: ' + JSON.stringify(result));
  }
  console.log('PASS DASH MPD parse + segment decode:', JSON.stringify(result));
  console.log('PASS DASH seeking and Shaka teardown');
} catch (error) {
  failed = true;
  console.error('FAIL DASH browser playback:', error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;
