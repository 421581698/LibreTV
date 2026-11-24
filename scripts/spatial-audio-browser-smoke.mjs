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

// Six-channel PCM fixture in conventional 5.1 order: L, R, C, LFE, Ls, Rs.
// This verifies the browser/Web Audio channel-routing graph, not Dolby bitstream decode.
const surroundChannels = 6;
const surroundFrequencies = [440, 550, 660, 80, 770, 880];
const wav51 = Buffer.alloc(44 + frameCount * surroundChannels * 2);
wav51.write('RIFF', 0);
wav51.writeUInt32LE(wav51.length - 8, 4);
wav51.write('WAVE', 8);
wav51.write('fmt ', 12);
wav51.writeUInt32LE(16, 16);
wav51.writeUInt16LE(1, 20);
wav51.writeUInt16LE(surroundChannels, 22);
wav51.writeUInt32LE(sampleRate, 24);
wav51.writeUInt32LE(sampleRate * surroundChannels * 2, 28);
wav51.writeUInt16LE(surroundChannels * 2, 32);
wav51.writeUInt16LE(16, 34);
wav51.write('data', 36);
wav51.writeUInt32LE(frameCount * surroundChannels * 2, 40);
for (let frame = 0; frame < frameCount; frame += 1) {
  for (let channel = 0; channel < surroundChannels; channel += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * surroundFrequencies[channel] * frame / sampleRate) * 3000);
    wav51.writeInt16LE(sample, 44 + (frame * surroundChannels + channel) * 2);
  }
}

const spatialSource = await readFile('src/lib/spatial-audio.ts', 'utf8');
const source = 'const exports = {};\n' + ts.transpileModule(spatialSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + '\nwindow.SpatialAudioEngine = exports.SpatialAudioEngine;';

// Keep Chromium's real autoplay policy: AudioContext activation must come from the button click below.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
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
    if (url.pathname === '/tone-51.wav') {
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav51, headers: { 'Access-Control-Allow-Origin': '*' } });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><audio id="media" src="/tone.wav" preload="auto"></audio><button id="enable">Enable spatial graph</button><audio id="surround" src="/tone-51.wav" preload="auto"></audio><button id="enable-surround">Enable 5.1 spatial graph</button></body></html>',
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
  await page.locator('#surround').evaluate(async media => {
    await new Promise((resolve, reject) => {
      media.addEventListener('canplaythrough', resolve, { once: true });
      media.addEventListener('error', () => reject(new Error('Generated six-channel PCM WAV failed to decode')), { once: true });
      media.load();
    });
  });
  await page.locator('#enable-surround').evaluate(button => {
    button.addEventListener('click', async () => {
      const media = document.querySelector('#surround');
      const engine = window.SpatialAudioEngine.attach(media, { inputChannels: 6, inputLayout: '5.1' });
      await engine.resumeFromUserGesture();
      const plan = engine.setMode('headphone-surround');
      await media.play();
      window.__spatialSurroundSmoke = { engine, plan };
    });
  });
  await page.locator('#enable-surround').click();
  await page.waitForFunction(() => window.__spatialSurroundSmoke?.engine?.status?.contextState === 'running');
  await page.waitForFunction(() => document.querySelector('#surround').currentTime > 0.5, undefined, { timeout: 8000 });
  const surroundActive = await page.evaluate(() => ({
    currentTime: document.querySelector('#surround').currentTime,
    status: window.__spatialSurroundSmoke.engine.status,
    route: window.__spatialSurroundSmoke.plan.route,
  }));
  if (surroundActive.route !== 'surround-5.1-binaural' || surroundActive.status.contextState !== 'running' || surroundActive.currentTime <= 0.5) {
    throw new Error('Real browser 5.1 PCM spatial graph did not enter its expected active state: ' + JSON.stringify(surroundActive));
  }
  await page.evaluate(() => {
    const { engine } = window.__spatialSurroundSmoke;
    engine.disable();
    window.__spatialSurroundSmoke.bypass = engine.status.route === 'bypass';
    document.querySelector('#surround').pause();
    document.querySelector('#surround').remove();
    window.__spatialSurroundSmoke.removal = engine.destroyAfterMediaElementRemoval();
  });
  await page.evaluate(() => window.__spatialSurroundSmoke.removal);
  const surroundTeardown = await page.evaluate(() => ({
    bypass: window.__spatialSurroundSmoke.bypass,
    destroyed: window.__spatialSurroundSmoke.engine.isDestroyed,
    contextState: window.__spatialSurroundSmoke.engine.status.contextState,
  }));
  if (!surroundTeardown.bypass || !surroundTeardown.destroyed || surroundTeardown.contextState !== 'closed') {
    throw new Error('5.1 spatial graph teardown did not close cleanly: ' + JSON.stringify(surroundTeardown));
  }
  console.log('PASS real Chromium 5.1 PCM spatial graph:', JSON.stringify({ surroundActive, surroundTeardown }));

  const corsGuard = await page.evaluate(() => {
    const unsafe = document.createElement('audio');
    unsafe.src = 'https://cross-origin.invalid/track.wav';
    let factoryCalls = 0;
    try {
      window.SpatialAudioEngine.attach(unsafe, { inputChannels: 2 }, () => {
        factoryCalls += 1;
        return new AudioContext();
      });
      return false;
    } catch (error) {
      return String(error?.message || error).includes('CORS') && factoryCalls === 0;
    }
  });
  if (!corsGuard) throw new Error('Cross-origin media was not rejected before AudioContext creation');
  console.log('PASS real Chromium Web Audio graph:', JSON.stringify({ active, teardown, surroundActive, surroundTeardown, corsGuard }));
} catch (error) {
  failed = true;
  console.error('FAIL real Chromium Web Audio graph:', error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;
