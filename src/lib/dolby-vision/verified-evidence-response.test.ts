import { describe, expect, it } from 'vitest';
import { parseVerifiedDolbyVisionEvidenceResponse } from './verified-evidence-response';

const assetId = 'dv_asset-123';
const validResponse = {
  verified: true,
  assetId,
  keyId: 'dv-key-1',
  issuedAt: 1_800_000_000,
  expiresAt: 1_800_003_600,
  sourceHashBinding: 'matched',
  evidence: {
    source: 'dovi_tool',
    parserVersion: '2.3.4',
    verified: true,
    rpuPresent: true,
    profile: null,
    frameCount: 240,
    metadataLevels: [1, 2, 5, 6],
  },
};

describe('parseVerifiedDolbyVisionEvidenceResponse', () => {
  it('accepts complete server-verified evidence for the expected asset', () => {
    expect(parseVerifiedDolbyVisionEvidenceResponse(validResponse, assetId)).toEqual(validResponse);
  });

  it('rejects a response for a different asset', () => {
    expect(parseVerifiedDolbyVisionEvidenceResponse(validResponse, 'dv_other')).toBeNull();
  });

  it('rejects detached or unsigned evidence', () => {
    expect(parseVerifiedDolbyVisionEvidenceResponse({
      ...validResponse,
      sourceHashBinding: 'detached',
    }, assetId)).toBeNull();
    expect(parseVerifiedDolbyVisionEvidenceResponse({
      ...validResponse,
      verified: false,
    }, assetId)).toBeNull();
  });

  it('rejects unsupported parser versions and malformed evidence', () => {
    expect(parseVerifiedDolbyVisionEvidenceResponse({
      ...validResponse,
      evidence: { ...validResponse.evidence, parserVersion: '2.4.0' },
    }, assetId)).toBeNull();
    expect(parseVerifiedDolbyVisionEvidenceResponse({
      ...validResponse,
      evidence: { ...validResponse.evidence, frameCount: -1 },
    }, assetId)).toBeNull();
  });

  it('rejects expired-order envelopes and invalid asset identifiers', () => {
    expect(parseVerifiedDolbyVisionEvidenceResponse({
      ...validResponse,
      expiresAt: validResponse.issuedAt,
    }, assetId)).toBeNull();
    expect(parseVerifiedDolbyVisionEvidenceResponse(validResponse, '../asset')).toBeNull();
  });
});
