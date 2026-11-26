import { describe, expect, it } from 'vitest';
import { parseVerifiedHlsSegmentEvidenceResponse } from './hls-segment-evidence-response';

const resourceId = 'resource_1';
const variantId = 'variant:playlist';
const segment = (ordinal: number) => ({
  ordinal,
  fragmentAssetId: `segment:${ordinal}`,
  frameCount: 240,
  metadataLevels: [1, 2, 5],
  rpuSha256: (ordinal === 0 ? 'b' : 'c').repeat(64),
});
const valid = {
  verified: true,
  analysisScope: 'hls-fmp4-segment-set',
  resourceId,
  variantAssetId: variantId,
  graph: { graphSha256: 'a'.repeat(64) },
  segmentCount: 2,
  totalRpuFrameCount: 480,
  timelineContinuity: 'contiguous',
  rpuProfileContinuity: 'consistent',
  rpuFrameAlignment: 'frame-count-matches-video-samples',
  rpuSemanticContinuity: 'not-established',
  semanticEvidenceLimitation: 'per-frame-rpu-boundaries-not-signed',
  verifiedParserVersion: '2.3.4',
  verifiedMetadataLevelFrameCounts: { '1': 480, '2': 480, '5': 2 },
  orderedRpuEvidenceSha256: 'd'.repeat(64),
  segments: [segment(0), segment(1)],
};

describe('verified HLS segment-set diagnostics response', () => {
  it('preserves only graph-bound, server-verified evidence without claiming Dolby output', () => {
    const result = parseVerifiedHlsSegmentEvidenceResponse(valid, resourceId, variantId);
    expect(result).toMatchObject({
      segmentCount: 2,
      totalRpuFrameCount: 480,
      metadataLevels: [1, 2, 5],
      verifiedParserVersion: '2.3.4',
      verifiedMetadataLevelFrameCounts: { '1': 480, '2': 480, '5': 2 },
      orderedRpuEvidenceSha256: 'd'.repeat(64),
    });
    expect(result).not.toHaveProperty('dolbyVisionOutput');
  });

  it('rejects asset mixups, counterfeit evidence states and malformed hashes', () => {
    expect(parseVerifiedHlsSegmentEvidenceResponse(valid, resourceId, 'another-variant')).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({ ...valid, verified: false }, resourceId, variantId)).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({ ...valid, rpuSemanticContinuity: 'established' }, resourceId, variantId)).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({ ...valid, orderedRpuEvidenceSha256: 'bad' }, resourceId, variantId)).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({ ...valid, verifiedParserVersion: '0.0.0' }, resourceId, variantId)).toBeNull();
  });

  it('rejects missing/reordered/duplicate fragments and inconsistent counts', () => {
    expect(parseVerifiedHlsSegmentEvidenceResponse({ ...valid, totalRpuFrameCount: 479 }, resourceId, variantId)).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({ ...valid, segments: [segment(1), segment(0)] }, resourceId, variantId)).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({ ...valid, segments: [segment(0), segment(0)] }, resourceId, variantId)).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({ ...valid, segmentCount: 3 }, resourceId, variantId)).toBeNull();
  });

  it('rejects duplicate level declarations and insufficient per-fragment metadata coverage', () => {
    const duplicate = { ...segment(0), metadataLevels: [1, 1, 2, 5] };
    expect(parseVerifiedHlsSegmentEvidenceResponse({
      ...valid, segments: [duplicate, segment(1)],
    }, resourceId, variantId)).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({
      ...valid, verifiedMetadataLevelFrameCounts: { '1': 480, '2': 480, '5': 1 },
    }, resourceId, variantId)).toBeNull();
  });
  it('rejects invalid signed metadata-level coverage', () => {
    expect(parseVerifiedHlsSegmentEvidenceResponse({
      ...valid, verifiedMetadataLevelFrameCounts: { '1': 480, '2': 480 },
    }, resourceId, variantId)).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({
      ...valid, verifiedMetadataLevelFrameCounts: { '1': 481, '2': 480, '5': 2 },
    }, resourceId, variantId)).toBeNull();
    expect(parseVerifiedHlsSegmentEvidenceResponse({
      ...valid, verifiedMetadataLevelFrameCounts: { '1': 480, '2': 480, '7': 2 },
    }, resourceId, variantId)).toBeNull();
  });
});
