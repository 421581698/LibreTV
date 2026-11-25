import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalizeDolbyVisionRpuPayload, verifySignedDolbyVisionRpuEnvelope, verifySignedDolbyVisionRpuSegmentSet } from './signed-rpu-envelope';

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

  it('verifies every signed HLS fragment and rejects sequence or tfdt gaps', () => {
    const expectedSegments = [0, 1].map((ordinal) => ({
      fragmentAssetId: `segment:${ordinal + 1}`,
      fragmentSha256: (ordinal === 0 ? 'd' : 'e').repeat(64),
      initializationAssetId: 'init:001',
      initializationSha256: 'a'.repeat(64),
      assembledSegmentSha256: (ordinal === 0 ? 'f' : '9').repeat(64),
      fragmentSequenceNumber: ordinal + 1,
      decodeTime: ordinal * 9600,
      sampleDuration: 9600,
      sampleCount: 240,
      timescale: 1000,
    }));
    const envelopes = expectedSegments.map((segment, ordinal) => {
      const analysisContext = {
        scope: 'hls-fmp4-segment' as const,
        resourceId: 'resource_hls_123',
        graphId: 'graph_123',
        graphSha256: 'c'.repeat(64),
        rootAssetId: 'root:playlist',
        variantAssetId: 'variant:playlist',
        fragmentCount: 2,
        fragmentSequenceContinuity: 'sequential' as const,
        temporalContinuity: 'contiguous' as const,
        fragmentOrdinal: ordinal,
        ...segment,
      };
      const payload = {
        version: 1,
        keyId: options.expectedKeyId,
        assetId: segment.fragmentAssetId,
        issuedAt: now - 10,
        expiresAt: now + 3600,
        report: { ...report, sourceMediaSha256: segment.assembledSegmentSha256 },
        analysisContext,
      };
      const signature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(payload)), privateKey).toString('base64url');
      return { ...payload, signature };
    });
    const trusted = {
      publicKeyPem,
      expectedKeyId: options.expectedKeyId,
      resourceId: 'resource_hls_123',
      graphId: 'graph_123',
      graphSha256: 'c'.repeat(64),
      rootAssetId: 'root:playlist',
      variantAssetId: 'variant:playlist',
      expectedFragmentCount: 2,
      expectedSegments,
      now,
    };
    expect(verifySignedDolbyVisionRpuSegmentSet(envelopes, trusted)).toMatchObject({
      totalRpuFrameCount: 480,
      timelineContinuity: 'contiguous',
      rpuProfileContinuity: 'consistent',
      rpuFrameAlignment: 'frame-count-matches-video-samples',
      rpuSemanticContinuity: 'not-established',
      semanticEvidenceLimitation: 'per-frame-rpu-boundaries-not-signed',
      verifiedDecodeEnd: 19200,
      verifiedTimescale: 1000,
      verifiedParserVersion: '2.3.4',
      verifiedMetadataLevelFrameCounts: { '1': 480, '2': 480, '5': 2, '6': 2 },
    });
    const verifiedSet = verifySignedDolbyVisionRpuSegmentSet(envelopes, trusted);
    expect(verifiedSet?.orderedRpuEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    const independentlyBoundDigest = createHash('sha256').update(canonicalizeDolbyVisionRpuPayload({
      scope: 'hls-ordered-rpu-evidence-v1',
      graphSha256: trusted.graphSha256,
      resourceId: trusted.resourceId,
      variantAssetId: trusted.variantAssetId,
      orderedEvidence: envelopes.map((envelope, ordinal) => ({
        ordinal,
        fragmentAssetId: expectedSegments[ordinal].fragmentAssetId,
        fragmentSha256: expectedSegments[ordinal].fragmentSha256,
        rpuSha256: envelope.report.rpuSha256,
        frameCount: envelope.report.frameCount,
        parserVersion: envelope.report.parserVersion,
      })),
    })).digest('hex');
    expect(verifiedSet?.orderedRpuEvidenceSha256).toBe(independentlyBoundDigest);
    expect(verifySignedDolbyVisionRpuSegmentSet(envelopes, {
      ...trusted,
      expectedSegments: [expectedSegments[0], { ...expectedSegments[1], decodeTime: 9700 }],
    })).toBeNull();
    expect(verifySignedDolbyVisionRpuSegmentSet(envelopes, {
      ...trusted,
      expectedSegments: [expectedSegments[0], { ...expectedSegments[1], fragmentSequenceNumber: 4 }],
    })).toBeNull();
    expect(verifySignedDolbyVisionRpuSegmentSet(envelopes, {
      ...trusted,
      expectedSegments: [expectedSegments[0], { ...expectedSegments[1], fragmentAssetId: expectedSegments[0].fragmentAssetId }],
    })).toBeNull();
    const changedProfile = {
      ...envelopes[1],
      report: {
        ...report,
        profile: 7,
        profiles: [7],
        sourceMediaSha256: expectedSegments[1].assembledSegmentSha256,
      },
    };
    const changedPayload: Record<string, unknown> = { ...changedProfile };
    delete changedPayload.signature;
    const changedSignature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(changedPayload)), privateKey).toString('base64url');
    expect(verifySignedDolbyVisionRpuSegmentSet([envelopes[0], { ...changedProfile, signature: changedSignature }], trusted)).toBeNull();
    const differentParser = {
      ...envelopes[1],
      report: { ...envelopes[1].report, parserVersion: '2.3.5' },
    };
    const differentParserPayload: Record<string, unknown> = { ...differentParser };
    delete differentParserPayload.signature;
    const differentParserSignature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(differentParserPayload)), privateKey).toString('base64url');
    expect(verifySignedDolbyVisionRpuSegmentSet([
      envelopes[0], { ...differentParser, signature: differentParserSignature },
    ], trusted)).toBeNull();
    const misalignedReport = {
      ...envelopes[0],
      report: {
        ...report,
        frameCount: 239,
        metadataLevelFrameCounts: { '1': 239, '2': 239, '5': 1, '6': 1 },
        sourceMediaSha256: expectedSegments[0].assembledSegmentSha256,
      },
    };
    const misalignedPayload: Record<string, unknown> = { ...misalignedReport };
    delete misalignedPayload.signature;
    const misalignedSignature = sign(null, Buffer.from(canonicalizeDolbyVisionRpuPayload(misalignedPayload)), privateKey).toString('base64url');
    expect(verifySignedDolbyVisionRpuSegmentSet([
      { ...misalignedReport, signature: misalignedSignature },
      envelopes[1],
    ], trusted)).toBeNull();
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
