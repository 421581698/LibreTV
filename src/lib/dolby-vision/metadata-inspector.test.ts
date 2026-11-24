import { describe, expect, it } from 'vitest';
import { inspectDolbyVisionFormat } from './format-inspector';
import { inspectDolbyVisionMetadata, type DolbyVisionRpuEvidence } from './metadata-inspector';

const declared = inspectDolbyVisionFormat({ codecs: 'dvh1.08.06' });

describe('inspectDolbyVisionMetadata', () => {
  it('does not infer RPU presence from a Dolby Vision codec declaration', () => {
    expect(inspectDolbyVisionMetadata({ format: declared })).toMatchObject({
      declarationDetected: true,
      rpuPresence: 'unknown',
      dynamicMetadata: 'unknown',
      evidenceSource: 'manifest-only',
    });
  });

  it('accepts a validated parser summary as RPU evidence', () => {
    const evidence: DolbyVisionRpuEvidence = {
      source: 'dovi_tool',
      parserVersion: '2.3.4',
      verified: true,
      rpuPresent: true,
      profile: 8,
      frameCount: 240,
      metadataLevels: [1, 2, 5, 6],
    };
    expect(inspectDolbyVisionMetadata({ format: declared, rpuEvidence: evidence })).toMatchObject({
      rpuPresence: 'present',
      dynamicMetadata: 'confirmed',
      profile: 8,
      frameCount: 240,
      metadataLevels: [1, 2, 5, 6],
      evidenceSource: 'dovi_tool',
      consistentWithDeclaration: true,
    });
  });

  it('flags a profile mismatch instead of silently accepting it', () => {
    const evidence: DolbyVisionRpuEvidence = {
      source: 'libdovi', parserVersion: '1.0.0', verified: true,
      rpuPresent: true, profile: 7, frameCount: 100, metadataLevels: [1],
    };
    expect(inspectDolbyVisionMetadata({ format: declared, rpuEvidence: evidence }).consistentWithDeclaration).toBe(false);
  });

  it('keeps dynamic metadata unknown when an RPU is reported without parsed levels', () => {
    const evidence: DolbyVisionRpuEvidence = {
      source: 'external-parser', parserVersion: '0.1.0', verified: true,
      rpuPresent: true, profile: 8, frameCount: 1, metadataLevels: [],
    };
    expect(inspectDolbyVisionMetadata({ format: declared, rpuEvidence: evidence })).toMatchObject({
      rpuPresence: 'present',
      dynamicMetadata: 'unknown',
    });
  });

  it('does not claim RPU exists when the parser reports none', () => {
    const evidence: DolbyVisionRpuEvidence = {
      source: 'dovi_tool', parserVersion: '2.3.4', verified: true,
      rpuPresent: false, profile: null, frameCount: 0, metadataLevels: [],
    };
    expect(inspectDolbyVisionMetadata({ format: declared, rpuEvidence: evidence })).toMatchObject({
      rpuPresence: 'absent',
      dynamicMetadata: 'not-confirmed',
    });
  });

  it('rejects malformed parser evidence and returns unknown', () => {
    const evidence = {
      source: 'dovi_tool', parserVersion: '', verified: true,
      rpuPresent: true, profile: 8, frameCount: -1, metadataLevels: [1],
    } as DolbyVisionRpuEvidence;
    expect(inspectDolbyVisionMetadata({ format: declared, rpuEvidence: evidence })).toMatchObject({
      rpuPresence: 'unknown',
      dynamicMetadata: 'unknown',
      evidenceSource: 'none',
    });
  });
});
