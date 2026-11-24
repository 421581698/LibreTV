import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'node:test';
import {
  authorizeBearer,
  canonicalize,
  createSignedEnvelope,
  isValidAssetId,
} from './server.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const report = {
  inputKind: 'hevc',
  extractionScope: { track: null, frameLimit: null },
  inputSha256: 'a'.repeat(64),
  parserVersion: '2.3.4',
};

describe('Dolby Vision parser service security primitives', () => {
  it('canonicalizes nested JSON with deterministic key ordering', () => {
    expect(canonicalize({ z: 1, a: { y: true, b: 2 } })).toBe('{"a":{"b":2,"y":true},"z":1}');
  });

  it('validates stable asset IDs and rejects path-like values', () => {
    expect(isValidAssetId('catalog:episode_123')).toBe(false);
    expect(isValidAssetId('catalog:episode-123')).toBe(true);
    expect(isValidAssetId('../secret')).toBe(false);
  });

  it('compares backend bearer credentials without accepting malformed headers', () => {
    expect(authorizeBearer('Bearer service-secret', 'service-secret')).toBe(true);
    expect(authorizeBearer('Bearer wrong', 'service-secret')).toBe(false);
    expect(authorizeBearer('service-secret', 'service-secret')).toBe(false);
    expect(authorizeBearer(undefined, 'service-secret')).toBe(false);
  });

  it('signs full-scope parser reports with Ed25519', () => {
    const envelope = createSignedEnvelope(report, 'catalog:episode-123', 'dv-key-1', privateKeyPem, 1800000000);
    const { signature, ...payload } = envelope;
    expect(verify(null, Buffer.from(canonicalize(payload)), publicKeyPem, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(envelope).toMatchObject({
      version: 1,
      keyId: 'dv-key-1',
      assetId: 'catalog:episode-123',
      issuedAt: 1800000000,
      expiresAt: 1800003600,
    });
  });

  it('refuses partial reports and detached RPU files', () => {
    expect(() => createSignedEnvelope({ ...report, extractionScope: { track: null, frameLimit: 50 } }, 'catalog:episode-123', 'dv-key-1', privateKeyPem)).toThrow();
    expect(() => createSignedEnvelope({ ...report, inputKind: 'rpu' }, 'catalog:episode-123', 'dv-key-1', privateKeyPem)).toThrow();
  });
});
