#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDolbyVisionParserServer, canonicalize } from '../../services/dolby-vision-parser/server.mjs';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node verify-parser-service-fixture.mjs <real-dolby-vision-mp4>');
const media = await readFile(inputPath);
assert.ok(media.length > 0, 'fixture MP4 must not be empty');
const mediaSha256 = createHash('sha256').update(media).digest('hex');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const assetId = 'ci:dolby-vision-real-rpu-fixture';

const server = createDolbyVisionParserServer({
  DV_SERVICE_TOKEN: 'ci-real-fixture-token',
  DV_SIGNING_KEY_ID: 'ci-real-fixture-key',
  DV_SIGNING_PRIVATE_KEY_PEM: privateKeyPem,
  DOVI_TOOL_BIN: process.env.DOVI_TOOL_BIN || '/usr/local/bin/dovi_tool',
  FFPROBE_BIN: process.env.FFPROBE_BIN || 'ffprobe',
  FFMPEG_BIN: process.env.FFMPEG_BIN || 'ffmpeg',
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert.ok(address && typeof address === 'object');

try {
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/analyze`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ci-real-fixture-token',
      'Content-Type': 'application/octet-stream',
      'X-DV-Asset-ID': assetId,
      'X-DV-Asset-SHA256': mediaSha256,
      'X-DV-Source-Content-Type': 'video/mp4',
    },
    body: media,
  });
  const responseText = await response.text();
  assert.equal(response.status, 200, `parser service rejected real MP4 fixture: ${responseText}`);
  const envelope = JSON.parse(responseText);
  const { signature, ...payload } = envelope;

  assert.equal(envelope.version, 1);
  assert.equal(envelope.keyId, 'ci-real-fixture-key');
  assert.equal(envelope.assetId, assetId);
  assert.equal(verify(
    null,
    Buffer.from(canonicalize(payload), 'utf8'),
    publicKey,
    Buffer.from(signature, 'base64url'),
  ), true, 'Ed25519 signature must cover the exact analysis report');

  const report = envelope.report;
  assert.equal(report.source, 'dovi_tool');
  assert.equal(report.parserVersion, '2.3.4');
  assert.equal(report.inputKind, 'hevc');
  assert.equal(report.verified, true);
  assert.equal(report.rpuPresent, true);
  assert.equal(report.frameCount, 259, 'all 259 fixture RPU frames must be parsed');
  assert.deepEqual(report.extractionScope, { track: null, frameLimit: null });
  assert.equal(report.sourceMediaSha256, mediaSha256, 'report must bind the exact uploaded MP4 bytes');
  assert.match(report.inputSha256, /^[a-f0-9]{64}$/);
  assert.match(report.rpuSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(report.profiles) && report.profiles.length > 0);
  assert.ok(Array.isArray(report.metadataLevels));
  assert.deepEqual(
    Object.keys(report.metadataLevelFrameCounts).map(Number).sort((a, b) => a - b),
    [...report.metadataLevels].sort((a, b) => a - b),
  );
  for (const count of Object.values(report.metadataLevelFrameCounts)) {
    assert.ok(Number.isSafeInteger(count) && count > 0 && count <= report.frameCount);
  }

  process.stdout.write(`${JSON.stringify({
    result: 'real-mp4-full-rpu-analysis-passed',
    parserVersion: report.parserVersion,
    profiles: report.profiles,
    frameCount: report.frameCount,
    metadataLevelFrameCounts: report.metadataLevelFrameCounts,
    sourceMediaSha256: report.sourceMediaSha256,
    hevcInputSha256: report.inputSha256,
    rpuSha256: report.rpuSha256,
    signatureVerified: true,
    extractionScope: report.extractionScope,
  }, null, 2)}\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
