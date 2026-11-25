import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeBearer,
  canonicalize,
  createSignedEnvelope,
  createDolbyVisionParserServer,
  isValidAssetId,
  readBoundedInteger,
} from './server.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const report = {
  source: 'dovi_tool',
  parserVersion: '2.3.4',
  verified: true,
  rpuPresent: true,
  profile: 8,
  profiles: [8],
  frameCount: 3,
  metadataLevels: [1],
  metadataLevelFrameCounts: { '1': 3 },
  input: 'sample.hevc',
  inputSha256: 'a'.repeat(64),
  sourceMediaSha256: 'a'.repeat(64),
  rpuSha256: 'b'.repeat(64),
  inputKind: 'hevc',
  extractionScope: { track: null, frameLimit: null },
  notes: [],
};

function writeBits(bits, value, count) {
  for (let index = count - 1; index >= 0; index -= 1) bits.push((value >> index) & 1);
}
function writeVariableBits(bits, value, width) {
  const max = 1 << width;
  if (value < max) { writeBits(bits, value, width); bits.push(0); return; }
  let remaining = value;
  while (true) {
    const tmp = remaining >> width;
    const clipped = tmp << width;
    remaining -= clipped;
    writeBits(bits, (clipped - max) >> width, width);
    bits.push(1);
    if (remaining <= max) break;
  }
  writeBits(bits, remaining, width);
  bits.push(0);
}
function packBits(bits) {
  while (bits.length % 8) bits.push(0);
  const output = Buffer.alloc(bits.length / 8);
  bits.forEach((bit, index) => { output[index >> 3] |= bit << (7 - (index & 7)); });
  return output;
}
function leb(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}
function obu(type, payload) {
  return Buffer.concat([Buffer.from([(type << 3) | 0x02]), leb(payload.length), payload]);
}
function makeAv1ObuFixture() {
  const rpu = Buffer.alloc(22, 0x55);
  rpu[rpu.length - 1] = 0x80;
  const bits = [];
  writeBits(bits, 0x003b, 16);
  writeBits(bits, 0x00000800, 32);
  writeBits(bits, 0, 2);
  writeBits(bits, 6, 3);
  writeBits(bits, 31, 5);
  writeVariableBits(bits, 225, 5);
  writeBits(bits, 0, 4);
  writeBits(bits, 1, 1);
  writeVariableBits(bits, rpu.length, 8);
  for (const byte of rpu) writeBits(bits, byte, 8);
  const t35 = Buffer.concat([Buffer.from([0xb5]), packBits(bits)]);
  return Buffer.concat([
    obu(2, Buffer.alloc(0)),
    obu(5, Buffer.concat([leb(4), t35])),
    obu(6, Buffer.from([0])),
  ]);
}

describe('Dolby Vision parser service security primitives', () => {
  it('canonicalizes nested JSON with deterministic key ordering', () => {
    assert.equal(canonicalize({ z: 1, a: { y: true, b: 2 } }), '{"a":{"b":2,"y":true},"z":1}');
  });

  it('rejects invalid or unbounded service resource limits', () => {
    assert.equal(readBoundedInteger('LIMIT', undefined, 10, 1, 20), 10);
    assert.equal(readBoundedInteger('LIMIT', '20', 10, 1, 20), 20);
    assert.throws(() => readBoundedInteger('LIMIT', 'NaN', 10, 1, 20));
    assert.throws(() => readBoundedInteger('LIMIT', '-1', 10, 1, 20));
    assert.throws(() => readBoundedInteger('LIMIT', '21', 10, 1, 20));
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
    const envelope = createSignedEnvelope(report, 'catalog:episode-123', 'dv-key-1', privateKeyPem, report.sourceMediaSha256, 1800000000);
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

  it('signs AV1 RPU reports only when bound to the exact original MP4 digest', () => {
    const av1Report = {
      ...report,
      input: 'video-track.rpu',
      inputSha256: 'd'.repeat(64),
      inputKind: 'av1',
      extractionScope: { track: null, frameLimit: null },
      sourceMediaSha256: report.sourceMediaSha256,
    };
    const envelope = createSignedEnvelope(
      av1Report, 'catalog:av1-episode-1', 'dv-key-1', privateKeyPem,
      report.sourceMediaSha256, 1800000000,
    );
    assert.equal(envelope.report.inputKind, 'av1');
    assert.equal(envelope.report.sourceMediaSha256, report.sourceMediaSha256);
    assert.throws(() => createSignedEnvelope(
      { ...av1Report, sourceMediaSha256: 'c'.repeat(64) },
      'catalog:av1-episode-1', 'dv-key-1', privateKeyPem,
      report.sourceMediaSha256, 1800000000,
    ));
  });

  it('signs canonical HLS fMP4 graph provenance and rejects malformed context', () => {
    const context = {
      scope: 'hls-fmp4',
      resourceId: 'resource_hls_123',
      graphId: 'graph_123',
      graphSha256: 'c'.repeat(64),
      rootAssetId: 'root:playlist',
      variantAssetId: 'variant:playlist',
      fragmentCount: 24,
      fragmentSequenceContinuity: 'sequential',
      temporalContinuity: 'contiguous',
    };
    const envelope = createSignedEnvelope(
      report, 'hls:resource_hls_123:variant:playlist', 'dv-key-1',
      privateKeyPem, report.sourceMediaSha256, 1800000000, context,
    );
    assert.deepEqual(envelope.analysisContext, context);
    const { signature, ...payload } = envelope;
    assert.equal(verify(null, Buffer.from(canonicalize(payload)), publicKeyPem, Buffer.from(signature, 'base64url')), true);
    assert.throws(() => createSignedEnvelope(
      report, 'hls:resource_hls_123:variant:playlist', 'dv-key-1',
      privateKeyPem, report.sourceMediaSha256, 1800000000,
      { ...context, graphSha256: 'not-a-digest' },
    ));
  });

  it('refuses partial reports, selected-track-only reports, and detached RPU files', () => {
    assert.throws(() => createSignedEnvelope({ ...report, extractionScope: { track: null, frameLimit: 50 } }, 'catalog:episode-123', 'dv-key-1', privateKeyPem, report.sourceMediaSha256));
    assert.throws(() => createSignedEnvelope({ ...report, extractionScope: { track: 1, frameLimit: null } }, 'catalog:episode-123', 'dv-key-1', privateKeyPem, report.sourceMediaSha256));
    assert.throws(() => createSignedEnvelope({ ...report, inputKind: 'rpu' }, 'catalog:episode-123', 'dv-key-1', privateKeyPem, report.sourceMediaSha256));
  });

  it('refuses malformed metadata-level coverage before signing evidence', () => {
    assert.throws(() => createSignedEnvelope({
      ...report,
      metadataLevels: [1, 2],
      metadataLevelFrameCounts: { '1': 3 },
    }, 'catalog:episode-123', 'dv-key-1', privateKeyPem, report.sourceMediaSha256));
    assert.throws(() => createSignedEnvelope({
      ...report,
      metadataLevelFrameCounts: { '1': 4 },
    }, 'catalog:episode-123', 'dv-key-1', privateKeyPem, report.sourceMediaSha256));
    assert.throws(() => createSignedEnvelope({
      ...report,
      metadataLevels: [1, 1],
    }, 'catalog:episode-123', 'dv-key-1', privateKeyPem, report.sourceMediaSha256));
  });

  it('refuses to sign a report whose source digest is detached from the uploaded object', () => {
    assert.throws(
      () => createSignedEnvelope({ ...report, sourceMediaSha256: 'c'.repeat(64) }, 'catalog:episode-123', 'dv-key-1', privateKeyPem, report.sourceMediaSha256),
      /exact uploaded source media SHA-256/,
    );
    assert.throws(
      () => createSignedEnvelope(report, 'catalog:episode-123', 'dv-key-1', privateKeyPem, 'invalid'),
      /exact uploaded source media SHA-256/,
    );
  });

  it('runs the full upload-to-parser-to-signed-envelope HTTP path', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'libretv-dv-service-test-'));
    const fakeParser = resolve(directory, 'fake-dovi-tool.mjs');
    const fakeFfprobe = resolve(directory, 'fake-ffprobe.mjs');
    const fakeFfmpeg = resolve(directory, 'fake-ffmpeg.mjs');
    const { privateKey: servicePrivateKey, publicKey: servicePublicKey } = generateKeyPairSync('ed25519');
    const servicePrivatePem = servicePrivateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const servicePublicPem = servicePublicKey.export({ type: 'spki', format: 'pem' }).toString();
    const parserSource = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('dovi_tool 2.3.4\\n'); process.exit(0); }
if (args[0] === 'extract-rpu') {
  writeFileSync(args[args.indexOf('-o') + 1], Buffer.from('test-rpu'));
  process.exit(0);
}
if (args[0] === 'info') { process.stdout.write('Frames: 3\\nProfiles: 8\\n'); process.exit(0); }
if (args[0] === 'export') {
  const levels = args[args.indexOf('--levels') + 1].split(',');
  for (const item of levels) {
    const [level, path] = item.split('=');
    writeFileSync(path, level === 'level1'
      ? JSON.stringify([{ frame: 0 }, { frame: 1 }, { frame: 2 }])
      : '[]');
  }
  process.exit(0);
}
process.exit(2);
`;
    await writeFile(fakeParser, parserSource, { mode: 0o700 });
    await chmod(fakeParser, 0o700);
    await writeFile(fakeFfprobe, "#!/usr/bin/env node\nprocess.stdout.write('hevc\\n');\n", { mode: 0o700 });
    await chmod(fakeFfprobe, 0o700);
    await writeFile(fakeFfmpeg, "#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv.at(-1), Buffer.from('extracted-hevc-track'));\n", { mode: 0o700 });
    await chmod(fakeFfmpeg, 0o700);

    const server = createDolbyVisionParserServer({
      DV_SERVICE_TOKEN: 'integration-secret',
      DV_SIGNING_KEY_ID: 'integration-key-1',
      DV_SIGNING_PRIVATE_KEY_PEM: servicePrivatePem,
      DOVI_TOOL_BIN: fakeParser,
      FFPROBE_BIN: fakeFfprobe,
      FFMPEG_BIN: fakeFfmpeg,
    });
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const endpoint = `http://127.0.0.1:${address.port}/v1/analyze`;
    const media = Buffer.from('known test MP4 container bytes');
    const digest = createHash('sha256').update(media).digest('hex');
    const extractedHevcDigest = createHash('sha256').update('extracted-hevc-track').digest('hex');
    const headers = {
      Authorization: 'Bearer integration-secret',
      'Content-Type': 'application/octet-stream',
      'X-DV-Asset-Id': 'r_0123456789abcdef0123456789ab',
      'X-DV-Asset-SHA256': digest,
      'X-DV-Source-Content-Type': 'video/mp4',
    };

    try {
      const health = await fetch(`http://127.0.0.1:${address.port}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: 'ok', service: 'dolby-vision-parser' });

      const unauthorized = await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, Authorization: 'Bearer wrong' },
        body: media,
      });
      assert.equal(unauthorized.status, 401);

      const mismatch = await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, 'X-DV-Asset-SHA256': '0'.repeat(64) },
        body: media,
      });
      assert.equal(mismatch.status, 409);
      assert.deepEqual(await mismatch.json(), { error: 'ASSET_DIGEST_MISMATCH' });

      let response;
      // A digest-mismatch request remains counted until its temporary upload directory is removed.
      // Retry a transient capacity response rather than making this cleanup race flaky.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        response = await fetch(endpoint, { method: 'POST', headers, body: media });
        if (response.status !== 429) break;
        await response.arrayBuffer();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      assert.equal(response.status, 200);
      const envelope = await response.json();
      assert.equal(envelope.assetId, headers['X-DV-Asset-Id']);
      assert.equal(envelope.keyId, 'integration-key-1');
      assert.equal(envelope.report.inputSha256, extractedHevcDigest);
      assert.equal(envelope.report.sourceMediaSha256, digest);
      assert.equal(envelope.report.parserVersion, '2.3.4');
      assert.equal(envelope.report.frameCount, 3);
      assert.equal(envelope.report.metadataLevelFrameCounts['1'], 3);
      const { signature, ...payload } = envelope;
      assert.equal(
        verify(null, Buffer.from(canonicalize(payload)), servicePublicPem, Buffer.from(signature, 'base64url')),
        true,
      );

      const hlsContextHeaders = {
        ...headers,
        'X-DV-Asset-Id': 'hls:graph-bound-test',
        'X-DV-Analysis-Scope': 'hls-fmp4',
        'X-DV-HLS-Resource-ID': 'resource_hls_1',
        'X-DV-HLS-Graph-ID': 'root:playlist',
        'X-DV-HLS-Graph-SHA256': 'c'.repeat(64),
        'X-DV-HLS-Root-Asset-ID': 'root:playlist',
        'X-DV-HLS-Variant-Asset-ID': 'variant:playlist',
        'X-DV-HLS-Fragment-Count': '3',
        'X-DV-HLS-Fragment-Sequence-Continuity': 'sequential',
        'X-DV-HLS-Temporal-Continuity': 'contiguous',
      };
      let hlsResponse;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        hlsResponse = await fetch(endpoint, { method: 'POST', headers: hlsContextHeaders, body: media });
        if (hlsResponse.status !== 429) break;
        await hlsResponse.arrayBuffer();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      assert.equal(hlsResponse.status, 200);
      const hlsEnvelope = await hlsResponse.json();
      assert.deepEqual(hlsEnvelope.analysisContext, {
        scope: 'hls-fmp4',
        resourceId: 'resource_hls_1',
        graphId: 'root:playlist',
        graphSha256: 'c'.repeat(64),
        rootAssetId: 'root:playlist',
        variantAssetId: 'variant:playlist',
        fragmentCount: 3,
        fragmentSequenceContinuity: 'sequential',
        temporalContinuity: 'contiguous',
      });
      const { signature: hlsSignature, ...hlsPayload } = hlsEnvelope;
      assert.equal(
        verify(null, Buffer.from(canonicalize(hlsPayload)), servicePublicPem, Buffer.from(hlsSignature, 'base64url')),
        true,
      );

      // A fragment signature is independently bound to the exact init+fragment
      // upload, its immutable graph member, and its decode-time interval.
      const segmentContextHeaders = {
        ...hlsContextHeaders,
        'X-DV-Asset-Id': 'segment:0001',
        'X-DV-Analysis-Scope': 'hls-fmp4-segment',
        'X-DV-HLS-Fragment-Ordinal': '0',
        'X-DV-HLS-Fragment-Asset-ID': 'segment:0001',
        'X-DV-HLS-Fragment-SHA256': 'd'.repeat(64),
        'X-DV-HLS-Initialization-Asset-ID': 'init:001',
        'X-DV-HLS-Initialization-SHA256': 'e'.repeat(64),
        'X-DV-HLS-Assembled-Segment-SHA256': digest,
        'X-DV-HLS-Fragment-Sequence-Number': '1',
        'X-DV-HLS-Decode-Time': '0',
        'X-DV-HLS-Sample-Duration': '4000',
        'X-DV-HLS-Sample-Count': '1',
        'X-DV-HLS-Timescale': '1000',
      };
      let segmentResponse;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        segmentResponse = await fetch(endpoint, { method: 'POST', headers: segmentContextHeaders, body: media });
        if (segmentResponse.status !== 429) break;
        await segmentResponse.arrayBuffer();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      assert.equal(segmentResponse.status, 200);
      const segmentEnvelope = await segmentResponse.json();
      assert.deepEqual(segmentEnvelope.analysisContext, {
        scope: 'hls-fmp4-segment',
        resourceId: 'resource_hls_1',
        graphId: 'root:playlist',
        graphSha256: 'c'.repeat(64),
        rootAssetId: 'root:playlist',
        variantAssetId: 'variant:playlist',
        fragmentCount: 3,
        fragmentSequenceContinuity: 'sequential',
        temporalContinuity: 'contiguous',
        fragmentOrdinal: 0,
        fragmentAssetId: 'segment:0001',
        fragmentSha256: 'd'.repeat(64),
        initializationAssetId: 'init:001',
        initializationSha256: 'e'.repeat(64),
        assembledSegmentSha256: digest,
        fragmentSequenceNumber: 1,
        decodeTime: 0,
        sampleDuration: 4000,
        sampleCount: 1,
        timescale: 1000,
      });
      assert.equal(segmentEnvelope.report.sourceMediaSha256, digest);
      const { signature: segmentSignature, ...segmentPayload } = segmentEnvelope;
      assert.equal(
        verify(null, Buffer.from(canonicalize(segmentPayload)), servicePublicPem, Buffer.from(segmentSignature, 'base64url')),
        true,
      );
      let rejectedSegmentDigest;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        rejectedSegmentDigest = await fetch(endpoint, {
          method: 'POST',
          headers: { ...segmentContextHeaders, 'X-DV-HLS-Assembled-Segment-SHA256': 'f'.repeat(64) },
          body: media,
        });
        if (rejectedSegmentDigest.status !== 429) break;
        await rejectedSegmentDigest.arrayBuffer();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      assert.equal(rejectedSegmentDigest.status, 422);

      await writeFile(fakeFfprobe, "#!/usr/bin/env node\nprocess.stdout.write(['hevc', 'hevc'].join(String.fromCharCode(10)));\n", { mode: 0o700 });
      await chmod(fakeFfprobe, 0o700);
      let ambiguousVideoTracks;
      // The preceding successful response can reach the client just before the
      // service finishes its finally cleanup and releases the single-job slot.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        ambiguousVideoTracks = await fetch(endpoint, { method: 'POST', headers, body: media });
        if (ambiguousVideoTracks.status !== 429) break;
        await ambiguousVideoTracks.arrayBuffer();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      assert.equal(ambiguousVideoTracks.status, 415);
      assert.deepEqual(await ambiguousVideoTracks.json(), { error: 'SINGLE_HEVC_VIDEO_TRACK_REQUIRED' });

      // Exercise the complete AV1 MP4 demux -> OBU/EMDF extraction -> RPU
      // parser -> source-media-bound Ed25519 envelope path.
      const av1ObuFixture = resolve(directory, 'av1-video.obu');
      await writeFile(av1ObuFixture, makeAv1ObuFixture());
      await writeFile(fakeFfprobe, "#!/usr/bin/env node\nprocess.stdout.write('av1\\n');\n", { mode: 0o700 });
      await chmod(fakeFfprobe, 0o700);
      await writeFile(fakeFfmpeg, "#!/usr/bin/env node\nimport { copyFileSync } from 'node:fs';\ncopyFileSync(process.env.DV_TEST_AV1_OBU_FIXTURE, process.argv.at(-1));\n", { mode: 0o700 });
      await chmod(fakeFfmpeg, 0o700);
      const previousAv1Fixture = process.env.DV_TEST_AV1_OBU_FIXTURE;
      process.env.DV_TEST_AV1_OBU_FIXTURE = av1ObuFixture;
      try {
        let av1Response;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          av1Response = await fetch(endpoint, { method: 'POST', headers, body: media });
          if (av1Response.status !== 429) break;
          await av1Response.arrayBuffer();
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        }
        assert.equal(av1Response.status, 200);
        const av1Envelope = await av1Response.json();
        assert.equal(av1Envelope.report.inputKind, 'av1');
        assert.deepEqual(av1Envelope.report.extractionScope, { track: null, frameLimit: null });
        assert.equal(av1Envelope.report.sourceMediaSha256, digest);
        assert.equal(av1Envelope.report.rpuPresent, true);
        const { signature: av1Signature, ...av1Payload } = av1Envelope;
        assert.equal(
          verify(null, Buffer.from(canonicalize(av1Payload)), servicePublicPem, Buffer.from(av1Signature, 'base64url')),
          true,
        );
      } finally {
        if (previousAv1Fixture === undefined) delete process.env.DV_TEST_AV1_OBU_FIXTURE;
        else process.env.DV_TEST_AV1_OBU_FIXTURE = previousAv1Fixture;
      }
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
      await rm(directory, { recursive: true, force: true });
    }
  });

});
