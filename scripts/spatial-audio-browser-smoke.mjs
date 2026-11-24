#!/usr/bin/env node
/**
 * Real Chromium Web Audio smoke test for LibreTV's standalone spatial engine.
 * Uses a generated same-origin PCM WAV fixture; it verifies browser decode,
 * AudioContext activation, HRTF graph routing, bypass, and teardown.
 * This is not an iOS/Safari or Atmos bitstream acceptance test.
 */
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

const sampleRate = 48_000;
const durationSeconds = 4;
const frameCount = sampleRate * durationSeconds;
const wav = Buffer.alloc(44 + frameCount * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(frameCount * 2, 40);
for (let i = 0; i < frameCount; i += 1) {
  wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 8000), 44 + i * 2);
}

const spatialSource = await readFile('src/lib/spatial-audio.ts', 'utf8');
const source = 'const exports = {};\\n' + ts.transpileModule(spatialSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + '\\nwindow.SpatialAudioEngine = exports.SpatialAudioEngine;';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await page.route('http://127.0.0.1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/tone.wav') {
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav, headers: { 'Access-Control-Allow-Origin': '*' } });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><audio id="media" src="/tone.wav" preload="auto"></audio><button id="enable">Enable spatial graph</button></body></html>',
    });
  });
  await page.goto('http://127.0.0.1/');
  await page.addScriptTag({ content: source });
  await page.locator('#media').evaluate(async media => {
    await new Promise((resolve, reject) => {
      media.addEventListener('canplaythrough', resolve, { once: true });
      media.addEventListener('error', () => reject(new Error('Generated WAV failed to decode')), { once: true });
      media.load();
    });
  });
  await page.locator('#enable').evaluate(button => {
    button.addEventListener('click', async () => {
      const media = document.querySelector('#media');
      const engine = window.SpatialAudioEngine.attach(media, { inputChannels: 2 });
      await engine.resumeFromUserGesture();
      const plan = engine.setMode('headphone-stereo');
      await media.play();
      window.__spatialSmoke = { engine, plan };
    });
  });
  await page.locator('#enable').click();
  await page.waitForFunction(() => window.__spatialSmoke?.engine?.status?.contextState === 'running');
  await page.waitForFunction(() => document.querySelector('#media').currentTime > 0.5, undefined, { timeout: 8000 });
  const active = await page.evaluate(() => ({
    currentTime: document.querySelector('#media').currentTime,
    status: window.__spatialSmoke.engine.status,
    route: window.__spatialSmoke.plan.route,
  }));
  if (active.route !== 'stereo-virtualization' || active.status.contextState !== 'running' || active.currentTime <= 0.5) {
    throw new Error('Real browser spatial graph did not enter its expected active state: ' + JSON.stringify(active));
  }
  await page.evaluate(() => {
    const { engine } = window.__spatialSmoke;
    engine.disable();
    window.__spatialSmoke.bypass = engine.status.route === 'bypass';
    document.querySelector('#media').pause();
    document.querySelector('#media').remove();
    window.__spatialSmoke.removal = engine.destroyAfterMediaElementRemoval();
  });
  await page.evaluate(() => window.__spatialSmoke.removal);
  const teardown = await page.evaluate(() => ({
    bypass: window.__spatialSmoke.bypass,
    destroyed: window.__spatialSmoke.engine.isDestroyed,
    contextState: window.__spatialSmoke.engine.status.contextState,
  }));
  if (!teardown.bypass || !teardown.destroyed || teardown.contextState !== 'closed') {
    throw new Error('Spatial graph teardown did not close cleanly: ' + JSON.stringify(teardown));
  }
  console.log('PASS real Chromium Web Audio graph:', JSON.stringify({ active, teardown }));
} catch (error) {
  failed = true;
  console.error('FAIL real Chromium Web Audio graph:', error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;
