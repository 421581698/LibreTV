import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DolbyVisionRpuReportSchema, validateDolbyVisionRpuReport } from './rpu-evidence-contract';

const hash = 'a'.repeat(64);
const validHevcReport = {
  source: 'dovi_tool',
  parserVersion: '2.3.4',
  verified: true,
  rpuPresent: true,
  profile: 8,
  profiles: [8],
  frameCount: 240,
  metadataLevels: [1, 2, 5, 6],
  metadataLevelFrameCounts: { '1': 240, '2': 240, '5': 1, '6': 1 },
  input: 'sample.hevc',
  inputSha256: hash,
  sourceMediaSha256: hash,
  rpuSha256: 'b'.repeat(64),
  inputKind: 'hevc',
  extractionScope: { track: null, frameLimit: null },
  notes: ['offline parser evidence'],
};

describe('Dolby Vision RPU evidence report contract', () => {
  const actualReportPath = process.env.DOLBY_VISION_REPORT_PATH;

  it.skipIf(!actualReportPath)('accepts the real dovi_tool report emitted by CI', () => {
    const actualReport = JSON.parse(readFileSync(actualReportPath!, 'utf8')) as unknown;
    const result = validateDolbyVisionRpuReport(actualReport);
    expect(result, JSON.stringify(DolbyVisionRpuReportSchema.safeParse(actualReport), null, 2)).not.toBeNull();
    expect(result?.sourceHashBinding).toBe('detached');
    expect(result?.evidence.source).toBe('dovi_tool');
    expect(result?.evidence.rpuPresent).toBe(true);
  });

  it('accepts a strict report bound to the exact media SHA-256', () => {
    const result = validateDolbyVisionRpuReport(validHevcReport, hash);
    expect(result).not.toBeNull();
    expect(result?.sourceHashBinding).toBe('matched');
    expect(result?.evidence).toMatchObject({
      source: 'dovi_tool',
      parserVersion: '2.3.4',
      verified: true,
      rpuPresent: true,
      profile: 8,
      frameCount: 240,
      metadataLevels: [1, 2, 5, 6],
    });
  });

  it('rejects a report bound to a different media file', () => {
    expect(validateDolbyVisionRpuReport(validHevcReport, 'c'.repeat(64))).toBeNull();
  });

  it('keeps reports without an exact media hash detached', () => {
    expect(validateDolbyVisionRpuReport(validHevcReport)?.sourceHashBinding).toBe('detached');
  });

  it('does not bind an extracted RPU file to an unrelated media asset', () => {
    const report = {
      ...validHevcReport,
      input: 'RPU.bin',
      inputKind: 'rpu',
      extractionScope: 'pre-extracted-rpu-file',
    };
    expect(validateDolbyVisionRpuReport(report, hash)?.sourceHashBinding).toBe('detached');
  });

  it('rejects unknown parser versions, unexpected fields and malformed hashes', () => {
    expect(validateDolbyVisionRpuReport({ ...validHevcReport, parserVersion: '9.9.9' })).toBeNull();
    expect(validateDolbyVisionRpuReport({ ...validHevcReport, unexpected: true })).toBeNull();
    expect(validateDolbyVisionRpuReport({ ...validHevcReport, inputSha256: 'not-a-hash' })).toBeNull();
  });

  it('rejects inconsistent profile and metadata-level summaries', () => {
    expect(validateDolbyVisionRpuReport({ ...validHevcReport, profile: 7 })).toBeNull();
    expect(validateDolbyVisionRpuReport({ ...validHevcReport, metadataLevels: [1, 5] })).toBeNull();
    expect(validateDolbyVisionRpuReport({ ...validHevcReport, metadataLevels: [1, 1, 2, 5, 6] })).toBeNull();
    expect(validateDolbyVisionRpuReport({
      ...validHevcReport,
      metadataLevelFrameCounts: { '1': 241, '2': 240, '5': 1, '6': 1 },
    })).toBeNull();
  });

  it('requires HEVC extraction scope and an explicit detached-RPU scope', () => {
    expect(validateDolbyVisionRpuReport({ ...validHevcReport, extractionScope: 'pre-extracted-rpu-file' })).toBeNull();
    expect(validateDolbyVisionRpuReport({
      ...validHevcReport,
      inputKind: 'rpu',
      extractionScope: { track: 1, frameLimit: null },
    })).toBeNull();
  });
});
