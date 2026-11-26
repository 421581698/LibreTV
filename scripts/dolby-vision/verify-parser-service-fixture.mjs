#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDolbyVisionParserServer, canonicalize } from '../../services/dolby-vision-parser/server.mjs';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node verify-parser-service-fixture.mjs <real-dolby-vision-mp4>');
const media = await readFile(inputPath);
assert.ok(media.length > 0, 'fixture MP4 must not be empty');
const mediaSha256 = createHash('sha256').update(media).digest('hex');
const assetId = 'ci:dolby-vision-real-rpu-fixture';
const externalBaseUrl = process.env.DV_PARSER_BASE_URL;
let publicKey;
let serviceToken;
let keyId;
let baseUrl;
let server;

if (externalBaseUrl) {
  const endpoint = new URL(externalBaseUrl);
  assert.equal(endpoint.protocol, 'http:', 'CI external parser endpoint must use loopback HTTP only');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname),
    'external parser endpoint must resolve to loopback');
  assert.ok(process.env.DV_CI_PUBLIC_KEY_FILE, 'DV_CI_PUBLIC_KEY_FILE is required for container verification');
  publicKey = createPublicKey(await readFile(process.env.DV_CI_PUBLIC_KEY_FILE, 'utf8'));
  serviceToken = process.env.DV_CI_SERVICE_TOKEN;
  keyId = process.env.DV_CI_KEY_ID;
  baseUrl = endpoint.toString().replace(/\/$/, '');
  assert.ok(serviceToken && keyId, 'container verification token and key ID are required');
} else {
  const pair = generateKeyPairSync('ed25519');
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  publicKey = pair.publicKey;
  serviceToken = 'ci-real-fixture-token';
  keyId = 'ci-real-fixture-key';
  server = createDolbyVisionParserServer({
    DV_SERVICE_TOKEN: serviceToken,
    DV_SIGNING_KEY_ID: keyId,
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
  baseUrl = `http://127.0.0.1:${address.port}`;
}

try {
  const unauthorized = await fetch(`${baseUrl}/v1/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(),
  });
  assert.equal(unauthorized.status, 401, 'parser service must reject requests without its bearer token');

  const response = await fetch(`${baseUrl}/v1/analyze`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceToken}`,
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
  assert.equal(envelope.keyId, keyId);
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

  const mapping = report.frameMappingEvidence;
  assert.ok(mapping, 'real HEVC fixture must produce signed frame mapping');
  assert.equal(mapping.frames.length, report.frameCount);
  const digest = createHash('sha256').update('libretv-rpu-frame-mapping-v1\n' + mediaSha256 + '\n' + mapping.timeBase.numerator + '/' + mapping.timeBase.denominator + '\n');
  for (const [i, frame] of mapping.frames.entries()) {
    assert.equal(frame.frameOrdinal, i);
    assert.match(frame.rpuSha256, /^[a-f0-9]{64}$/);
    if (i) assert.ok(BigInt(frame.pts) > BigInt(mapping.frames[i-1].pts));
    digest.update(i + ':' + frame.pts + ':' + frame.rpuSha256 + '\n');
  }
  assert.equal(digest.digest('hex'), mapping.mappingSha256);
  assert.deepEqual(mapping.frames.map(f=>f.rpuSha256).sort(), [...report.rpuUnitEvidence.unitSha256s].sort());
  const duration = report.presentationDurationEvidence;
  if (process.env.DV_EXPECT_DURATION === 'absent') {
    assert.equal(duration, undefined, 'original irregular fixture must not claim contiguous presentation duration evidence');
  } else {
  assert.ok(duration, 'real HEVC fixture must produce signed sample durations');
  assert.equal(duration.durations.length, report.frameCount);
  assert.equal(duration.timescale, mapping.timeBase.denominator);
  assert.equal(mapping.timeBase.numerator, 1);
  let cursor = BigInt(duration.start);
  for (const [i, ticks] of duration.durations.entries()) {
    assert.ok(Number.isSafeInteger(ticks) && ticks > 0);
    assert.equal(BigInt(mapping.frames[i].pts), cursor);
    cursor += BigInt(ticks);
  }
  assert.equal(cursor, BigInt(duration.end));
  }

  process.stdout.write(`${JSON.stringify({
    result: externalBaseUrl ? 'docker-container-mp4-full-rpu-analysis-passed' : 'in-process-mp4-full-rpu-analysis-passed',
    parserVersion: report.parserVersion,
    profiles: report.profiles,
    frameCount: report.frameCount,
    metadataLevelFrameCounts: report.metadataLevelFrameCounts,
    sourceMediaSha256: report.sourceMediaSha256,
    hevcInputSha256: report.inputSha256,
    rpuSha256: report.rpuSha256,
    signatureVerified: true,
    unauthorizedRequestRejected: true,
    extractionScope: report.extractionScope,
  }, null, 2)}\n`);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
}
