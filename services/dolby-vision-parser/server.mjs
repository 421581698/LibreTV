#!/usr/bin/env node
import { createHash, createPrivateKey, sign, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ANALYZER = resolve(HERE, '../../scripts/dolby-vision/analyze-rpu.mjs');
const MAX_UPLOAD_BYTES = Number(process.env.DV_MAX_UPLOAD_BYTES || 512 * 1024 * 1024);
const MAX_CONCURRENT_JOBS = Number(process.env.DV_MAX_CONCURRENT_JOBS || 1);
const ANALYSIS_TIMEOUT_MS = Number(process.env.DV_ANALYSIS_TIMEOUT_MS || 15 * 60 * 1000);
let activeJobs = 0;

export function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Payload is not JSON serializable.');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
}

export function isValidAssetId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
}

export function authorizeBearer(header, expectedToken) {
  if (typeof header !== 'string' || !expectedToken) return false;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const supplied = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createSignedEnvelope(report, assetId, keyId, privateKeyPem, now = Math.floor(Date.now() / 1000)) {
  if (!isValidAssetId(assetId)) throw new Error('Invalid stable asset ID.');
  if (!keyId || keyId.length > 128) throw new Error('Invalid signing key ID.');
  if (!report || report.inputKind !== 'hevc' || report.extractionScope?.frameLimit !== null) {
    throw new Error('Only full-scope HEVC media reports can be signed.');
  }
  const payload = {
    version: 1,
    keyId,
    assetId,
    issuedAt: now,
    expiresAt: now + 3600,
    report,
  };
  const signature = sign(null, Buffer.from(canonicalize(payload)), createPrivateKey(privateKeyPem)).toString('base64url');
  return { ...payload, signature };
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

async function analyzeUpload(request, response, env) {
  const contentLength = Number(request.headers['content-length']);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
    sendJson(response, 413, { error: 'UPLOAD_SIZE_REJECTED' });
    return;
  }
  if (request.headers['content-type'] !== 'application/octet-stream') {
    sendJson(response, 415, { error: 'CONTENT_TYPE_REJECTED' });
    return;
  }

  const assetId = request.headers['x-dv-asset-id'];
  const expectedSha256 = request.headers['x-dv-asset-sha256'];
  if (!isValidAssetId(assetId) || !/^[a-f0-9]{64}$/i.test(expectedSha256 || '')) {
    sendJson(response, 400, { error: 'ASSET_ID_OR_DIGEST_INVALID' });
    return;
  }

  const directory = await mkdtemp(resolve(tmpdir(), 'libretv-dv-job-'));
  const inputPath = resolve(directory, 'input-media');
  const digest = createHash('sha256');
  let received = 0;
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        callback(new Error('upload limit exceeded'));
        return;
      }
      digest.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(request, meter, createWriteStream(inputPath, { flags: 'wx', mode: 0o600 }));
    if (received !== contentLength) {
      sendJson(response, 400, { error: 'CONTENT_LENGTH_MISMATCH' });
      return;
    }
    const actualSha256 = digest.digest('hex');
    if (actualSha256 !== expectedSha256.toLowerCase()) {
      sendJson(response, 409, { error: 'ASSET_DIGEST_MISMATCH' });
      return;
    }

    const { stdout } = await execFileAsync(process.execPath, [
      ANALYZER, '--input', inputPath, '--kind', 'hevc',
      '--dovi-tool', env.DOVI_TOOL_BIN || '/usr/local/bin/dovi_tool',
    ], {
      encoding: 'utf8',
      timeout: ANALYSIS_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    const report = JSON.parse(stdout);
    if (report.inputSha256 !== actualSha256 || report.inputKind !== 'hevc' ||
        report.extractionScope?.frameLimit !== null || !/^2\.3\.\d+$/.test(report.parserVersion || '')) {
      sendJson(response, 422, { error: 'PARSER_REPORT_REJECTED' });
      return;
    }
    const envelope = createSignedEnvelope(
      report,
      assetId,
      env.DV_SIGNING_KEY_ID,
      env.DV_SIGNING_PRIVATE_KEY_PEM,
    );
    sendJson(response, 200, envelope);
  } catch {
    if (!response.headersSent) sendJson(response, 422, { error: 'ANALYSIS_FAILED' });
    else response.destroy();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function createDolbyVisionParserServer(env = process.env) {
  if (!env.DV_SERVICE_TOKEN || !env.DV_SIGNING_KEY_ID || !env.DV_SIGNING_PRIVATE_KEY_PEM) {
    throw new Error('DV_SERVICE_TOKEN, DV_SIGNING_KEY_ID and DV_SIGNING_PRIVATE_KEY_PEM are required.');
  }
  // Validate the private key once at startup; secrets are never logged.
  createPrivateKey(env.DV_SIGNING_PRIVATE_KEY_PEM);

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/analyze') {
      sendJson(response, 404, { error: 'NOT_FOUND' });
      return;
    }
    if (!authorizeBearer(request.headers.authorization, env.DV_SERVICE_TOKEN)) {
      sendJson(response, 401, { error: 'UNAUTHORIZED' });
      return;
    }
    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      sendJson(response, 429, { error: 'CAPACITY_EXCEEDED' });
      return;
    }
    activeJobs += 1;
    try {
      await analyzeUpload(request, response, env);
    } finally {
      activeJobs -= 1;
    }
  });
  server.requestTimeout = ANALYSIS_TIMEOUT_MS + 60_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = createDolbyVisionParserServer();
  const port = Number(process.env.PORT || 8788);
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`Dolby Vision parser service listening on port ${port}\n`);
  });
}
