#!/usr/bin/env node
/**
 * CI-only AC-3 / E-AC-3 round-trip using self-generated sine PCM.
 * Validates that FFmpeg can encode, probe, then actually decode both carriers.
 * Synthetic PCM is NOT licensed movie content, a Safari playback test, Atmos
 * object evidence, bitstream passthrough, or physical speaker certification.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'libretv-dolby-audio-codecs-'));
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
const ffprobe = process.env.FFPROBE_BIN || 'ffprobe';

function run(binary, args, maxBuffer = 2 * 1024 * 1024) {
  return execFileSync(binary, args, {
    timeout: 120_000, maxBuffer, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

try {
  for (const codec of ['ac3', 'eac3']) {
    const filename = join(directory, codec + '.' + codec);
    run(ffmpeg, [
      '-hide_banner', '-v', 'error', '-nostdin',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
      '-ac', '2', '-ar', '48000', '-c:a', codec, '-b:a', '192k',
      '-f', codec, '-y', filename,
    ]);
    const encoded = await readFile(filename);
    assert.ok(encoded.length > 1000 && encoded.length < 512 * 1024, codec + ' carrier size invalid');
    assert.equal(encoded[0], 0x0b, codec + ' syncword high byte');
    assert.equal(encoded[1], 0x77, codec + ' syncword low byte');

    const report = JSON.parse(run(ffprobe, [
      '-v', 'error', '-f', codec, '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', filename,
    ]).toString('utf8'));
    assert.equal(report.streams?.length, 1);
    assert.equal(report.streams[0].codec_name, codec);
    assert.equal(Number(report.streams[0].sample_rate), 48000);
    assert.equal(Number(report.streams[0].channels), 2);

    const decoded = run(ffmpeg, [
      '-hide_banner', '-v', 'error', '-nostdin', '-f', codec, '-i', filename,
      '-map', '0:a:0', '-ar', '48000', '-ac', '2', '-f', 's16le', 'pipe:1',
    ], 512 * 1024);
    assert.equal(decoded.length % 4, 0, codec + ' PCM channel alignment');
    const samplesPerChannel = decoded.length / 4;
    assert.ok(samplesPerChannel >= 48000 && samplesPerChannel < 53000, codec + ' decoded duration invalid');
    let nonZero = false;
    for (let byte = 0; byte < decoded.length; byte += 2) {
      if (decoded.readInt16LE(byte) !== 0) { nonZero = true; break; }
    }
    assert.ok(nonZero, codec + ' PCM was silent');
    process.stdout.write(JSON.stringify({
      codec, encodedBytes: encoded.length, decodedSamplesPerChannel: samplesPerChannel,
      sampleRateHz: 48000, channels: 2, audioOutput: 'not-verified',
    }) + '\n');
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
