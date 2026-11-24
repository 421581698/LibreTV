import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySignedDolbyVisionRpuEnvelope } from './signed-rpu-envelope';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
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
  const signature = sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64url');
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

  it('rejects tampered payloads and signatures', () => {
    const envelope = makeEnvelope();
    expect(verifySignedDolbyVisionRpuEnvelope({ ...envelope, report: { ...report, profile: 7 } }, options)).toBeNull();
    expect(verifySignedDolbyVisionRpuEnvelope({ ...envelope, signature: 'A'.repeat(100) }, options)).toBeNull();
  });

  it('rejects the wrong trusted key ID or media asset identity', () => {
    const envelope = makeEnvelope();
    expect(verifySignedDolbyVisionRpuEnvelope(envelope, { ...options, expectedKeyId: 'rotated-key' })).toBeNull();
    expect(verifySignedDolbyVisionRpuEnvelope(envelope, { ...options, expectedAssetId: 'another-asset' })).toBeNull();
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
