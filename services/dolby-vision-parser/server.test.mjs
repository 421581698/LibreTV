import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.equal(canonicalize({ z: 1, a: { y: true, b: 2 } }), '{"a":{"b":2,"y":true},"z":1}');
  });

  it('validates stable asset IDs and rejects path-like values', () => {
    assert.equal(isValidAssetId('catalog:episode_123'), true);
    assert.equal(isValidAssetId('catalog:episode-123'), true);
    assert.equal(isValidAssetId('../secret'), false);
  });

  it('compares backend bearer credentials without accepting malformed headers', () => {
    assert.equal(authorizeBearer('Bearer service-secret', 'service-secret'), true);
    assert.equal(authorizeBearer('Bearer wrong', 'service-secret'), false);
    assert.equal(authorizeBearer('service-secret', 'service-secret'), false);
    assert.equal(authorizeBearer(undefined, 'service-secret'), false);
  });

  it('signs full-scope parser reports with Ed25519', () => {
    const envelope = createSignedEnvelope(report, 'catalog:episode-123', 'dv-key-1', privateKeyPem, 1800000000);
    const { signature, ...payload } = envelope;
    assert.equal(verify(null, Buffer.from(canonicalize(payload)), publicKeyPem, Buffer.from(signature, 'base64url')), true);
    assert.deepEqual({ version: envelope.version, keyId: envelope.keyId, assetId: envelope.assetId, issuedAt: envelope.issuedAt, expiresAt: envelope.expiresAt }, {
      version: 1,
      keyId: 'dv-key-1',
      assetId: 'catalog:episode-123',
      issuedAt: 1800000000,
      expiresAt: 1800003600,
    });
  });

  it('refuses partial reports and detached RPU files', () => {
    assert.throws(() => createSignedEnvelope({ ...report, extractionScope: { track: null, frameLimit: 50 } }, 'catalog:episode-123', 'dv-key-1', privateKeyPem));
    assert.throws(() => createSignedEnvelope({ ...report, inputKind: 'rpu' }, 'catalog:episode-123', 'dv-key-1', privateKeyPem));
  });
});
