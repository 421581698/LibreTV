#!/usr/bin/env node
import { createHash, createPrivateKey, sign, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const ANALYZER = resolve(HERE, '../../scripts/dolby-vision/analyze-rpu.mjs');
export function readBoundedInteger(name, rawValue, fallback, minimum, maximum) {
  const raw = rawValue === undefined || rawValue === '' ? String(fallback) : String(rawValue);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

const MAX_UPLOAD_BYTES = readBoundedInteger('DV_MAX_UPLOAD_BYTES', process.env.DV_MAX_UPLOAD_BYTES, 512 * 1024 * 1024, 1024, 2 * 1024 * 1024 * 1024);
const MAX_CONCURRENT_JOBS = readBoundedInteger('DV_MAX_CONCURRENT_JOBS', process.env.DV_MAX_CONCURRENT_JOBS, 1, 1, 8);
const ANALYSIS_TIMEOUT_MS = readBoundedInteger('DV_ANALYSIS_TIMEOUT_MS', process.env.DV_ANALYSIS_TIMEOUT_MS, 15 * 60 * 1000, 10_000, 60 * 60 * 1000);

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

function hasValidMetadataCoverage(report) {
  const allowedLevels = new Set([1, 2, 3, 4, 5, 6, 8, 9, 10, 11]);
  if (!Array.isArray(report?.metadataLevels) || !report.metadataLevelFrameCounts ||
      typeof report.metadataLevelFrameCounts !== 'object' || Array.isArray(report.metadataLevelFrameCounts)) {
    return false;
  }
  const levels = report.metadataLevels;
  if (levels.length === 0 || levels.some((level) =>
    !Number.isSafeInteger(level) || !allowedLevels.has(level)
  ) || new Set(levels).size !== levels.length) return false;
  const counts = report.metadataLevelFrameCounts;
  const countLevels = Object.keys(counts).map(Number);
  if (countLevels.some((level) => !Number.isSafeInteger(level)) ||
      countLevels.length !== levels.length ||
      [...countLevels].sort((a, b) => a - b).some((level, index) =>
        level !== [...levels].sort((a, b) => a - b)[index]
      )) return false;
  return Object.entries(counts).every(([level, count]) =>
    String(Number(level)) === level &&
    Number.isSafeInteger(count) &&
    count > 0 &&
    count <= report.frameCount
  );
}

export function createSignedEnvelope(report, assetId, keyId, privateKeyPem, expectedSourceMediaSha256, now = Math.floor(Date.now() / 1000), analysisContext = null) {
  if (!isValidAssetId(assetId)) throw new Error('Invalid stable asset ID.');
  if (!/^[a-f0-9]{64}$/i.test(expectedSourceMediaSha256 || '') ||
      typeof report?.sourceMediaSha256 !== 'string' ||
      report.sourceMediaSha256.toLowerCase() !== expectedSourceMediaSha256.toLowerCase()) {
    throw new Error('The signed report must match the exact uploaded source media SHA-256.');
  }
  if (!keyId || keyId.length > 128) throw new Error('Invalid signing key ID.');
  if (!report || report.source !== 'dovi_tool' || report.verified !== true || report.rpuPresent !== true ||
      !['hevc', 'av1'].includes(report.inputKind) || report.extractionScope?.track !== null || report.extractionScope?.frameLimit !== null ||
      !/^2\.3\.\d+$/.test(report.parserVersion || '') ||
      !/^[a-f0-9]{64}$/i.test(report.inputSha256 || '') ||
      !/^[a-f0-9]{64}$/i.test(report.sourceMediaSha256 || '') ||
      !/^[a-f0-9]{64}$/i.test(report.rpuSha256 || '') ||
      !Number.isSafeInteger(report.frameCount) || report.frameCount <= 0 ||
      !Array.isArray(report.profiles) || report.profiles.length === 0 ||
      !hasValidMetadataCoverage(report)) {
    throw new Error('Only structurally valid full-scope dovi_tool HEVC reports can be signed.');
  }
  if (analysisContext !== null) {
    if (analysisContext?.scope !== 'hls-fmp4' ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(analysisContext.resourceId || '') ||
        typeof analysisContext.graphId !== 'string' || !analysisContext.graphId ||
        analysisContext.graphId.length > 200 ||
        !/^[a-f0-9]{64}$/.test(analysisContext.graphSha256 || '') ||
        !/^[A-Za-z0-9:_-]{1,200}$/.test(analysisContext.rootAssetId || '') ||
        !/^[A-Za-z0-9:_-]{1,200}$/.test(analysisContext.variantAssetId || '') ||
        !Number.isSafeInteger(analysisContext.fragmentCount) ||
        analysisContext.fragmentCount < 1 || analysisContext.fragmentCount > 10_000 ||
        analysisContext.fragmentSequenceContinuity !== 'sequential' ||
        analysisContext.temporalContinuity !== 'contiguous') {
      throw new Error('Invalid HLS fMP4 provenance context.');
    }
  }
  const payload = {
    version: 1,
    keyId,
    assetId,
    issuedAt: now,
    expiresAt: now + 3600,
    report,
    ...(analysisContext ? { analysisContext } : {}),
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

  const sourceContentType = request.headers['x-dv-source-content-type'];
  if (!['video/mp4', 'video/hevc'].includes(sourceContentType)) {
    sendJson(response, 415, { error: 'SOURCE_CONTAINER_UNSUPPORTED' });
    return;
  }

  const directory = await mkdtemp(resolve(tmpdir(), 'libretv-dv-job-'));
  const inputPath = resolve(directory, 'input-media');
  const hevcPath = resolve(directory, 'video-track.hevc');
  const av1ObuPath = resolve(directory, 'video-track.obu');
  const av1RpuPath = resolve(directory, 'video-track.rpu');
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

    let analysisInputPath = inputPath;
    let analyzedCodec = sourceContentType === 'video/hevc' ? 'hevc' : null;
    if (sourceContentType === 'video/mp4') {
      const { stdout: codecOutput } = await execFileAsync(env.FFPROBE_BIN || 'ffprobe', [
        '-v', 'error',
        '-select_streams', 'v',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        inputPath,
      ], {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      });
      const videoCodecs = codecOutput.trim().split(/\r?\n/).filter(Boolean);
      // Accept one unambiguous HEVC or AV1 video track. Audio and subtitles
      // remain bound to the original container digest but are not parsed as video.
      if (videoCodecs.length !== 1 || !['hevc', 'av1'].includes(videoCodecs[0])) {
        sendJson(response, 415, { error: 'SINGLE_HEVC_OR_AV1_VIDEO_TRACK_REQUIRED' });
        return;
      }
      analyzedCodec = videoCodecs[0];
      if (analyzedCodec === 'hevc') {
        await execFileAsync(env.FFMPEG_BIN || 'ffmpeg', [
          '-nostdin', '-v', 'error', '-i', inputPath, '-map', '0:v:0',
          '-c:v', 'copy', '-bsf:v', 'hevc_mp4toannexb', '-f', 'hevc', hevcPath,
        ], { encoding: 'utf8', timeout: ANALYSIS_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true });
        const extracted = await stat(hevcPath).catch(() => null);
        if (!extracted?.isFile() || extracted.size <= 0 || extracted.size > MAX_UPLOAD_BYTES) {
          sendJson(response, extracted?.size > MAX_UPLOAD_BYTES ? 413 : 422, {
            error: extracted?.size > MAX_UPLOAD_BYTES ? 'EXTRACTED_TRACK_TOO_LARGE' : 'HEVC_TRACK_EXTRACTION_FAILED',
          });
          return;
        }
        analysisInputPath = hevcPath;
      } else {
        await execFileAsync(env.FFMPEG_BIN || 'ffmpeg', [
          '-nostdin', '-v', 'error', '-i', inputPath, '-map', '0:v:0',
          '-c:v', 'copy', '-f', 'obu', av1ObuPath,
        ], { encoding: 'utf8', timeout: ANALYSIS_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true });
        const obu = await stat(av1ObuPath).catch(() => null);
        if (!obu?.isFile() || obu.size <= 0 || obu.size > MAX_UPLOAD_BYTES) {
          sendJson(response, obu?.size > MAX_UPLOAD_BYTES ? 413 : 422, {
            error: obu?.size > MAX_UPLOAD_BYTES ? 'EXTRACTED_TRACK_TOO_LARGE' : 'AV1_TRACK_EXTRACTION_FAILED',
          });
          return;
        }
        await execFileAsync(process.execPath, [
          resolve(HERE, '../../scripts/dolby-vision/extract-av1-rpu.mjs'),
          '--input', av1ObuPath, '--output', av1RpuPath, '--kind', 'obu',
        ], { encoding: 'utf8', timeout: ANALYSIS_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true });
        const rpu = await stat(av1RpuPath).catch(() => null);
        if (!rpu?.isFile() || rpu.size <= 0 || rpu.size > MAX_UPLOAD_BYTES) {
          sendJson(response, rpu?.size > MAX_UPLOAD_BYTES ? 413 : 422, {
            error: rpu?.size > MAX_UPLOAD_BYTES ? 'EXTRACTED_RPU_TOO_LARGE' : 'AV1_DOLBY_RPU_NOT_FOUND',
          });
          return;
        }
        analysisInputPath = av1RpuPath;
      }
    }

    const { stdout } = await execFileAsync(process.execPath, [
      ANALYZER, '--input', analysisInputPath, '--kind', analyzedCodec === 'av1' ? 'rpu' : 'hevc',
      '--dovi-tool', env.DOVI_TOOL_BIN || '/usr/local/bin/dovi_tool',
    ], {
      encoding: 'utf8',
      timeout: ANALYSIS_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    const report = JSON.parse(stdout);
    const validFullScanScope = typeof report.extractionScope === 'object'
      ? report.extractionScope?.frameLimit === null
      : analyzedCodec === 'av1' && report.inputKind === 'rpu' &&
        report.extractionScope === 'pre-extracted-rpu-file';
    if ((sourceContentType === 'video/hevc' && report.inputSha256 !== actualSha256) ||
        !['hevc', 'rpu', 'av1'].includes(report.inputKind) || !validFullScanScope ||
        !/^2\.3\.\d+$/.test(report.parserVersion || '') ||
        !/^[a-f0-9]{64}$/i.test(report.inputSha256 || '')) {
      sendJson(response, 422, { error: 'PARSER_REPORT_REJECTED' });
      return;
    }
    // inputSha256 binds the extracted video/RPU bytes; sourceMediaSha256 binds
    // the original container object that the player actually consumes.
    if (analyzedCodec === 'av1') {
      report.inputKind = 'av1';
      report.extractionScope = { track: null, frameLimit: null };
    }
    report.sourceMediaSha256 = actualSha256;
    const hlsContextHeader = request.headers['x-dv-analysis-scope'];
    let analysisContext = null;
    if (hlsContextHeader !== undefined) {
      const fragmentCount = Number(request.headers['x-dv-hls-fragment-count']);
      analysisContext = {
        scope: hlsContextHeader,
        resourceId: request.headers['x-dv-hls-resource-id'],
        graphId: request.headers['x-dv-hls-graph-id'],
        graphSha256: request.headers['x-dv-hls-graph-sha256'],
        rootAssetId: request.headers['x-dv-hls-root-asset-id'],
        variantAssetId: request.headers['x-dv-hls-variant-asset-id'],
        fragmentCount,
        fragmentSequenceContinuity: request.headers['x-dv-hls-fragment-sequence-continuity'],
        temporalContinuity: request.headers['x-dv-hls-temporal-continuity'],
      };
    }
    const envelope = createSignedEnvelope(
      report,
      assetId,
      env.DV_SIGNING_KEY_ID,
      env.DV_SIGNING_PRIVATE_KEY_PEM,
      actualSha256,
      Math.floor(Date.now() / 1000),
      analysisContext,
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
  const signingPrivateKeyPem = env.DV_SIGNING_PRIVATE_KEY_PEM ||
    (env.DV_SIGNING_PRIVATE_KEY_FILE ? readFileSync(env.DV_SIGNING_PRIVATE_KEY_FILE, 'utf8') : '');
  if (!env.DV_SERVICE_TOKEN || !env.DV_SIGNING_KEY_ID || !signingPrivateKeyPem) {
    throw new Error('DV_SERVICE_TOKEN, DV_SIGNING_KEY_ID and a signing private key value/file are required.');
  }
  // Validate the private key once at startup; secrets are never logged.
  createPrivateKey(signingPrivateKeyPem);
  const runtimeEnv = { ...env, DV_SIGNING_PRIVATE_KEY_PEM: signingPrivateKeyPem };
  let activeJobs = 0;

  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { status: 'ok', service: 'dolby-vision-parser' });
      return;
    }
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
      await analyzeUpload(request, response, runtimeEnv);
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
