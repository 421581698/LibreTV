import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalizeDolbyVisionRpuPayload, verifySignedDolbyVisionRpuEnvelope } from './signed-rpu-envelope';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const { publicKey: wrongPublicKey } = generateKeyPairSync('ed25519');
const wrongPublicKeyPem = wrongPublicKey.export({ type: 'spki', format: 'pem' }).toString();
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const hash = 'a'.repeat(64);
const report = {
  source: 'dovi_tool',
  parserVersion: '2.3.4',
  verified: true,
  rpuPresent: true,
  profile: 8,
  profiles: [8],
  frameCount: 240,
  metadataLevels: [1, 2, 5, 6],
  metadataLevelFrameCounts: { '1': 240, '2': 240, '5': 1, '6': 1 },
  input: 'asset.hevc',
  inputSha256: hash,
  sourceMediaSha256: hash,
  rpuSha256: 'b'.repeat(64),
  inputKind: 'hevc',
  extractionScope: { track: null, frameLimit: null },
  notes: ['full-stream parser report'],
};
const now = 1_800_000_000;

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  const payload = {
    version: 1,
    keyId: 'dv-prod-2026-01',
    assetId: 'media:catalog:episode-123',
    issuedAt: now - 10,
    expiresAt: now + 3600,
    report,
    ...overrides,
  };
  const signature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(payload)), privateKey).toString('base64url');
  return { ...payload, signature };
}

const options = {
  publicKeyPem,
  expectedKeyId: 'dv-prod-2026-01',
  expectedAssetId: 'media:catalog:episode-123',
  expectedMediaSha256: hash,
  now,
};

describe('signed Dolby Vision RPU envelope', () => {
  it('accepts a valid Ed25519 signature bound to the trusted asset and exact media digest', () => {
    const result = verifySignedDolbyVisionRpuEnvelope(makeEnvelope(), options);
    expect(result).toMatchObject({
      assetId: options.expectedAssetId,
      keyId: options.expectedKeyId,
      sourceHashBinding: 'matched',
      evidence: { source: 'dovi_tool', rpuPresent: true, profile: 8 },
    });
  });

  it('verifies an AV1 RPU report against the original MP4 digest', () => {
    const av1Report = {
      ...report,
      input: 'video-track.rpu',
      inputSha256: 'd'.repeat(64),
      inputKind: 'av1',
      extractionScope: { track: null, frameLimit: null },
      sourceMediaSha256: hash,
    };
    const payload = {
      version: 1,
      keyId: options.expectedKeyId,
      assetId: options.expectedAssetId,
      issuedAt: now - 10,
      expiresAt: now + 3600,
      report: av1Report,
    };
    const signature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(payload)), privateKey).toString('base64url');
    expect(verifySignedDolbyVisionRpuEnvelope({ ...payload, signature }, options)).toMatchObject({
      sourceHashBinding: 'matched',
      report: { inputKind: 'av1', sourceMediaSha256: hash },
    });
  });

  it('rejects tampered payloads and signatures', () => {
    const envelope = makeEnvelope();
    expect(verifySignedDolbyVisionRpuEnvelope({ ...envelope, report: { ...report, profile: 7 } }, options)).toBeNull();
    expect(verifySignedDolbyVisionRpuEnvelope({ ...envelope, signature: 'A'.repeat(100) }, options)).toBeNull();
  });

  it('rejects the wrong signing key, key ID, unsupported version or media asset identity', () => {
    const envelope = makeEnvelope();
    expect(verifySignedDolbyVisionRpuEnvelope(envelope, { ...options, publicKeyPem: wrongPublicKeyPem })).toBeNull();
    expect(verifySignedDolbyVisionRpuEnvelope(envelope, { ...options, expectedKeyId: 'rotated-key' })).toBeNull();
    expect(verifySignedDolbyVisionRpuEnvelope({ ...envelope, version: 2 }, options)).toBeNull();
    expect(verifySignedDolbyVisionRpuEnvelope(envelope, { ...options, expectedAssetId: 'another-asset' })).toBeNull();
  });

  it('requires exact expected HLS graph provenance for HLS-scoped signatures', () => {
    const analysisContext = {
      scope: 'hls-fmp4' as const,
      resourceId: 'resource_hls_123',
      graphId: 'graph_123',
      graphSha256: 'c'.repeat(64),
      rootAssetId: 'root:playlist',
      variantAssetId: 'variant:playlist',
      fragmentCount: 24,
      fragmentSequenceContinuity: 'sequential' as const,
      temporalContinuity: 'contiguous' as const,
    };
    const envelope = makeEnvelope({ analysisContext });
    expect(verifySignedDolbyVisionRpuEnvelope(envelope, options)).toBeNull();
    expect(verifySignedDolbyVisionRpuEnvelope(envelope, {
      ...options,
      expectedAnalysisContext: analysisContext,
    })).toMatchObject({ analysisContext });
    expect(verifySignedDolbyVisionRpuEnvelope(envelope, {
      ...options,
      expectedAnalysisContext: { ...analysisContext, graphSha256: 'd'.repeat(64) },
    })).toBeNull();
  });

  it('verifies a fragment signature against its graph member, init bytes, and exact segment digest', () => {
    const assembledSegmentSha256 = 'f'.repeat(64);
    const segmentContext = {
      scope: 'hls-fmp4-segment' as const,
      resourceId: 'resource_hls_123',
      graphId: 'graph_123',
      graphSha256: 'c'.repeat(64),
      rootAssetId: 'root:playlist',
      variantAssetId: 'variant:playlist',
      fragmentCount: 2,
      fragmentSequenceContinuity: 'sequential' as const,
      temporalContinuity: 'contiguous' as const,
      fragmentOrdinal: 0,
      fragmentAssetId: 'segment:0001',
      fragmentSha256: 'd'.repeat(64),
      initializationAssetId: 'init:001',
      initializationSha256: 'e'.repeat(64),
      assembledSegmentSha256,
      fragmentSequenceNumber: 1,
      decodeTime: 0,
      sampleDuration: 4000,
      sampleCount: 100,
      timescale: 1000,
    };
    const payload = {
      version: 1,
      keyId: options.expectedKeyId,
      assetId: segmentContext.fragmentAssetId,
      issuedAt: now - 10,
      expiresAt: now + 3600,
      report: { ...report, sourceMediaSha256: assembledSegmentSha256 },
      analysisContext: segmentContext,
    };
    const signature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(payload)), privateKey).toString('base64url');
    const result = verifySignedDolbyVisionRpuEnvelope({ ...payload, signature }, {
      ...options,
      expectedAssetId: segmentContext.fragmentAssetId,
      expectedMediaSha256: assembledSegmentSha256,
      expectedAnalysisContext: segmentContext,
    });
    expect(result).toMatchObject({
      sourceHashBinding: 'matched',
      analysisContext: segmentContext,
      report: { sourceMediaSha256: assembledSegmentSha256 },
    });
    expect(verifySignedDolbyVisionRpuEnvelope({ ...payload, signature }, {
      ...options,
      expectedAssetId: segmentContext.fragmentAssetId,
      expectedMediaSha256: hash,
      expectedAnalysisContext: segmentContext,
    })).toBeNull();
  });

  it('rejects media digest mismatch, expired reports and reports issued in the future', () => {
    const envelope = makeEnvelope();
    expect(verifySignedDolbyVisionRpuEnvelope(envelope, { ...options, expectedMediaSha256: 'c'.repeat(64) })).toBeNull();
    expect(verifySignedDolbyVisionRpuEnvelope(makeEnvelope({ expiresAt: now - 1 }), options)).toBeNull();
    expect(verifySignedDolbyVisionRpuEnvelope(makeEnvelope({ issuedAt: now + 120 }), options)).toBeNull();
  });

  it('rejects partial scans and detached RPU inputs even when correctly signed', () => {
    const partial = makeEnvelope({ report: { ...report, extractionScope: { track: null, frameLimit: 120 } } });
    expect(verifySignedDolbyVisionRpuEnvelope(partial, options)).toBeNull();
    const detached = makeEnvelope({ report: { ...report, inputKind: 'rpu', extractionScope: 'pre-extracted-rpu-file' } });
    expect(verifySignedDolbyVisionRpuEnvelope(detached, options)).toBeNull();
  });
});
