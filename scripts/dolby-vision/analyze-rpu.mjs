#!/usr/bin/env node
/**
 * Offline Dolby Vision RPU analysis adapter for dovi_tool.
 *
 * This script is intentionally not imported by the browser bundle or deployed
 * Cloudflare Worker. It analyzes a local HEVC/MKV file or an already-extracted
 * RPU file and emits a compact, evidence-backed JSON summary.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LEVELS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11];
const MAX_BUFFER = 32 * 1024 * 1024;

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export function parseDoviToolInfoSummary(output) {
  const frameMatch = output.match(/^\s*Frames:\s*(\d+)\s*$/im);
  const profileLine = output.match(/^\s*Profiles?:\s*([^\r\n]+)$/im);
  if (!frameMatch || !profileLine) {
    throw new Error('无法解析 dovi_tool info --summary 输出；缺少 Frames 或 Profile 字段。');
  }
  const profiles = [...new Set((profileLine[1].match(/\b\d{1,2}\b/g) ?? []).map(Number))]
    .filter((profile) => Number.isInteger(profile) && profile >= 0 && profile <= 20)
    .sort((a, b) => a - b);
  if (profiles.length === 0) {
    throw new Error('dovi_tool summary 未提供有效 Dolby Vision Profile。');
  }
  const frameCount = Number(frameMatch[1]);
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) {
    throw new Error('dovi_tool summary 的 RPU 帧数必须大于 0。');
  }
  return { frameCount, profiles };
}

export function parseLevelExportFiles(levelFiles) {
  const metadataLevelFrameCounts = {};
  for (const [level, raw] of Object.entries(levelFiles)) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`RPU Level ${level} 导出不是有效 JSON。`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`RPU Level ${level} 导出必须是数组。`);
    }
    const validFrames = parsed.filter((record) =>
      record && typeof record === 'object' && Number.isSafeInteger(record.frame) && record.frame >= 0
    );
    if (validFrames.length !== parsed.length) {
      throw new Error(`RPU Level ${level} 导出包含无效帧记录。`);
    }
    if (validFrames.length > 0) metadataLevelFrameCounts[level] = validFrames.length;
  }
  return {
    metadataLevels: Object.keys(metadataLevelFrameCounts).map(Number).sort((a, b) => a - b),
    metadataLevelFrameCounts,
  };
}

function run(binary, args) {
  try {
    return execFileSync(binary, args, {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: 15 * 60 * 1000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n').slice(-6000);
    throw new Error(`dovi_tool 执行失败：${detail}`);
  }
}

function parseArgs(argv) {
  const options = { kind: 'hevc', track: null, limit: null, binary: process.env.DOVI_TOOL_BIN || 'dovi_tool' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--input') options.input = argv[++index];
    else if (flag === '--kind') options.kind = argv[++index];
    else if (flag === '--track') options.track = argv[++index];
    else if (flag === '--limit') options.limit = argv[++index];
    else if (flag === '--dovi-tool') options.binary = argv[++index];
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`未知参数：${flag}`);
  }
  if (options.help) return options;
  if (!options.input) throw new Error('必须提供 --input <本地文件路径>。');
  if (!['hevc', 'rpu'].includes(options.kind)) throw new Error('--kind 仅支持 hevc 或 rpu。');
  if (options.track !== null && (!/^\d+$/.test(options.track) || Number(options.track) < 1)) {
    throw new Error('--track 必须是大于等于 1 的 Matroska 视频轨道编号。');
  }
  if (options.limit !== null && (!/^\d+$/.test(options.limit) || Number(options.limit) < 1)) {
    throw new Error('--limit 必须是正整数。');
  }
  return options;
}

export async function analyzeRpu(options) {
  const inputPath = resolve(options.input);
  await access(inputPath);
  const inputStat = await stat(inputPath);
  if (!inputStat.isFile() || inputStat.size <= 0) throw new Error('输入必须是非空的本地文件。');

  const inputSha256 = await sha256File(inputPath);
  const tempDirectory = await mkdtemp(resolve(tmpdir(), 'libretv-dovi-'));
  try {
    const rpuPath = options.kind === 'rpu'
      ? inputPath
      : resolve(tempDirectory, 'extracted-rpu.bin');

    if (options.kind === 'hevc') {
      const extractArgs = ['extract-rpu', '-i', inputPath, '-o', rpuPath];
      if (options.track !== null) extractArgs.push('--track-number', options.track);
      if (options.limit !== null) extractArgs.push('--limit', options.limit);
      run(options.binary, extractArgs);
    }

    const rpuStat = await stat(rpuPath).catch(() => null);
    if (!rpuStat?.isFile() || rpuStat.size <= 0) {
      throw new Error('输入范围内没有提取到非空 RPU；结果为未确认，不会伪造 RPU 证据。');
    }

    const versionOutput = run(options.binary, ['--version']).trim();
    const versionMatch = versionOutput.match(/\b(\d+\.\d+\.\d+)\b/);
    if (!versionMatch) throw new Error('无法确认 dovi_tool 版本号。');

    const summaryOutput = run(options.binary, ['info', '-i', rpuPath, '--summary']);
    const summary = parseDoviToolInfoSummary(summaryOutput);

    const levelPaths = Object.fromEntries(LEVELS.map((level) => [
      level,
      resolve(tempDirectory, `level-${level}.json`),
    ]));
    const levelsArg = LEVELS.map((level) => `level${level}=${levelPaths[level]}`).join(',');
    run(options.binary, [
      'export', '-i', rpuPath, '--levels-format', 'json', '--levels', levelsArg,
    ]);

    const levelFiles = {};
    for (const level of LEVELS) {
      const path = levelPaths[level];
      const bytes = await readFile(path).catch(() => null);
      // A missing export file is not treated as an empty level: it is a parser failure.
      if (!bytes) throw new Error(`dovi_tool 未生成 Level ${level} 导出文件。`);
      levelFiles[level] = bytes.toString('utf8');
    }
    const levels = parseLevelExportFiles(levelFiles);
    const rpuSha256 = await sha256File(rpuPath);

    return {
      source: 'dovi_tool',
      parserVersion: versionMatch[1],
      verified: true,
      rpuPresent: true,
      profile: summary.profiles.length === 1 ? summary.profiles[0] : null,
      profiles: summary.profiles,
      frameCount: summary.frameCount,
      metadataLevels: levels.metadataLevels,
      metadataLevelFrameCounts: levels.metadataLevelFrameCounts,
      input: basename(inputPath),
      inputSha256,
      rpuSha256,
      inputKind: options.kind,
      extractionScope: options.kind === 'hevc'
        ? { track: options.track === null ? null : Number(options.track), frameLimit: options.limit === null ? null : Number(options.limit) }
        : 'pre-extracted-rpu-file',
      notes: [
        '此结果来自本机 dovi_tool 对输入文件/RPU 字节的实际解析。',
        'RPU 解析成功不等于浏览器解码器、设备或显示器已经输出 Dolby Vision。',
        'frameCount 仅覆盖本次送入解析器的 RPU 范围；HEVC 输入可受 --limit 和 --track 限制。',
      ],
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write([
      'LibreTV offline Dolby Vision RPU analyzer',
      'Usage: node scripts/dolby-vision/analyze-rpu.mjs --input <file> [--kind hevc|rpu] [--track N] [--limit N] [--dovi-tool PATH]',
      'Default kind is hevc. Use kind=rpu for an already extracted RPU binary.',
      'Requires dovi_tool 2.3.x installed locally. No media is uploaded.',
      '',
    ].join('\n'));
    return;
  }
  const report = await analyzeRpu(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Dolby Vision RPU analysis failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
