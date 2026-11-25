#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
  return process.argv[index + 1];
}

const reportPath = arg('--report');
const inputPath = arg('--input');
const expectedFrames = Number(arg('--expected-frames'));
if (!Number.isSafeInteger(expectedFrames) || expectedFrames <= 0) throw new Error('Invalid expected frame count.');

const [rawReport, inputBytes] = await Promise.all([readFile(reportPath, 'utf8'), readFile(inputPath)]);
const report = JSON.parse(rawReport);
const inputSha256 = createHash('sha256').update(inputBytes).digest('hex');

const failures = [];
if (report.source !== 'dovi_tool') failures.push('unexpected parser identity');
if (report.parserVersion !== '2.3.4') failures.push('unexpected parser version');
if (report.verified !== true || report.rpuPresent !== true) failures.push('RPU was not positively parsed');
if (report.inputKind !== 'hevc') failures.push('report is not based on HEVC media input');
if (report.extractionScope?.track !== null || report.extractionScope?.frameLimit !== null) failures.push('report is not a whole-input, all-track scan');
if (report.inputSha256 !== inputSha256 || report.sourceMediaSha256 !== inputSha256) failures.push('input digest does not match exact fixture bytes');
if (report.frameCount !== expectedFrames) failures.push(`expected ${expectedFrames} RPU frames, received ${report.frameCount}`);
if (!Array.isArray(report.profiles) || report.profiles.length === 0) failures.push('no parsed Dolby Vision profile');
if (!/^[a-f0-9]{64}$/i.test(report.rpuSha256 || '')) failures.push('missing RPU SHA-256');
if (!Array.isArray(report.metadataLevels) || !report.metadataLevelFrameCounts || typeof report.metadataLevelFrameCounts !== 'object') failures.push('missing metadata-level coverage');
else {
  const levels = [...report.metadataLevels].sort((a, b) => a - b);
  const countLevels = Object.keys(report.metadataLevelFrameCounts).map(Number).sort((a, b) => a - b);
  if (JSON.stringify(levels) !== JSON.stringify(countLevels)) failures.push('metadata level counts do not match exported levels');
  if (Object.values(report.metadataLevelFrameCounts).some((count) => !Number.isSafeInteger(count) || count <= 0 || count > report.frameCount)) failures.push('invalid per-level frame coverage');
}
if (failures.length) throw new Error(`Full RPU acceptance failed: ${failures.join('; ')}`);

process.stdout.write(`${JSON.stringify({
  result: 'full-rpu-scan-passed',
  parserVersion: report.parserVersion,
  profiles: report.profiles,
  frameCount: report.frameCount,
  metadataLevelFrameCounts: report.metadataLevelFrameCounts,
  inputSha256: report.inputSha256,
  rpuSha256: report.rpuSha256,
  extractionScope: report.extractionScope,
}, null, 2)}\n`);
