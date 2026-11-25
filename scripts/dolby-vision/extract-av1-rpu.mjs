#!/usr/bin/env node
/**
 * Strict Dolby Vision AV1 T.35 / EMDF extractor.
 * Accepts a T.35 payload, raw low-overhead AV1 OBU stream, or AV1 MP4/IVF
 * container. This is a metadata extractor, not an AV1 video decoder.
 */
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const T35_HEADER = Buffer.from([0x00, 0x3b, 0x00, 0x00, 0x08, 0x00, 0x37, 0xcd, 0x08]);
const ANNEX_B_START_CODE = Buffer.from([0x00, 0x00, 0x00, 0x01]);
const COUNTRY_CODE_US = 0xb5;
const MAX_OBU_BYTES = 16 * 1024 * 1024;
const MAX_OBUS = 1_000_000;
const MAX_RPU_UNITS = 100_000;

class BitReader {
  constructor(data) { this.data = data; this.bitOffset = 0; }
  readBits(count) {
    if (!Number.isInteger(count) || count < 0 || count > 32 ||
        this.bitOffset + count > this.data.length * 8) throw new Error('Truncated AV1 Dolby EMDF bit field.');
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const bit = (this.data[this.bitOffset >> 3] >> (7 - (this.bitOffset & 7))) & 1;
      value = value * 2 + bit;
      this.bitOffset += 1;
    }
    return value;
  }
  readBytes(count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 65535 ||
        this.bitOffset + count * 8 > this.data.length * 8) throw new Error('Dolby EMDF payload size exceeds available T.35 data.');
    const result = Buffer.allocUnsafe(count);
    for (let index = 0; index < count; index += 1) result[index] = this.readBits(8);
    return result;
  }
}

function readVariableBits(reader, groupBits) {
  let value = 0;
  for (let groups = 0; groups < 4; groups += 1) {
    const part = reader.readBits(groupBits);
    if (value > 65535 - part) throw new Error('Dolby EMDF variable-bit value overflows 16-bit bound.');
    value += part;
    if (reader.readBits(1) === 0) return value;
    if (value > Math.floor((65535 - (2 ** groupBits)) / (2 ** groupBits))) throw new Error('Dolby EMDF variable-bit value overflows 16-bit bound.');
    value = value * (2 ** groupBits) + (2 ** groupBits);
  }
  throw new Error('Dolby EMDF variable-bit value is overlong.');
}

export function regularRpuToHevcUnspec62Nalu(value) {
  const rpu = Buffer.from(value);
  if (rpu.length < 7 || rpu[0] !== 0x19) {
    throw new Error('Regular Dolby RPU must start with the 0x19 prefix.');
  }
  const escaped = [];
  let zeroCount = 0;
  for (const byte of rpu) {
    if (zeroCount >= 2 && byte <= 0x03) {
      escaped.push(0x03);
      zeroCount = 0;
    }
    escaped.push(byte);
    zeroCount = byte === 0 ? zeroCount + 1 : 0;
  }
  return Buffer.concat([Buffer.from([0x7c, 0x01]), Buffer.from(escaped)]);
}

export function extractDolbyRpuFromT35(value) {
  const input = Buffer.from(value);
  if (input.length < 34 || input.length > 1024 * 1024) throw new Error('AV1 Dolby T.35 metadata payload length is outside supported bounds.');
  const data = input[0] === COUNTRY_CODE_US ? input.subarray(1) : input;
  if (data.length < T35_HEADER.length || !data.subarray(0, T35_HEADER.length).equals(T35_HEADER)) {
    throw new Error('AV1 T.35 country/provider header is not the Dolby Vision identifier.');
  }
  const reader = new BitReader(data);
  if (reader.readBits(16) !== 0x003b) throw new Error('Unexpected Dolby T.35 terminal provider code.');
  if (reader.readBits(32) !== 0x00000800) throw new Error('Unexpected Dolby T.35 provider-oriented code.');
  if (reader.readBits(2) !== 0) throw new Error('Unsupported Dolby EMDF version.');
  if (reader.readBits(3) !== 6) throw new Error('Unexpected Dolby EMDF key ID.');
  if (reader.readBits(5) !== 31) throw new Error('Unexpected Dolby EMDF payload ID.');
  if (readVariableBits(reader, 5) !== 225) throw new Error('Unexpected Dolby EMDF payload ID extension.');
  if (reader.readBits(4) !== 0) throw new Error('Unsupported Dolby EMDF optional fields.');
  if (reader.readBits(1) !== 1) throw new Error('Unsupported Dolby EMDF discard flag.');
  const payloadSize = readVariableBits(reader, 8);
  if (payloadSize < 1 || payloadSize > 65535) throw new Error('Dolby EMDF RPU payload size is invalid.');
  const rpuPayload = reader.readBytes(payloadSize);
  let lastNonZero = rpuPayload.length - 1;
  while (lastNonZero >= 0 && rpuPayload[lastNonZero] === 0) lastNonZero -= 1;
  if (lastNonZero < 0 || rpuPayload[lastNonZero] !== 0x80) throw new Error('Extracted Dolby RPU does not end with required 0x80 terminator.');
  return Buffer.concat([Buffer.from([0x19]), rpuPayload]);
}

function readLeb128(data, offset) {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 8 && offset < data.length; count += 1) {
    const byte = data[offset++];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error('AV1 OBU size overflows the safe integer range.');
    if ((byte & 0x80) === 0) return { value, next: offset };
    multiplier *= 128;
  }
  throw new Error('AV1 OBU size LEB128 is truncated or overlong.');
}

function parseDolbyRpuObuStream(inputValue) {
  const data = Buffer.from(inputValue);
  const t35Payloads = [];
  const rpuTemporalUnits = new Set();
  let offset = 0, obuCount = 0, temporalUnit = -1, temporalDelimiterCount = 0, frameUnitCount = 0;
  const framesByTemporalUnit = new Map();
  const rpuUnits = [];
  while (offset < data.length) {
    if (obuCount >= MAX_OBUS) throw new Error('AV1 OBU count exceeds configured limit.');
    const header = data[offset++];
    if ((header & 0x81) !== 0) throw new Error('AV1 OBU forbidden/reserved header bit is set.');
    const type = (header >> 3) & 0x0f;
    const extensionPresent = (header & 0x04) !== 0;
    if ((header & 0x02) === 0) throw new Error('AV1 OBU without explicit size field is not accepted.');
    if (extensionPresent && (offset >= data.length || (data[offset++] & 0x07) !== 0)) {
      throw new Error('AV1 OBU extension header is truncated or malformed.');
    }
    const length = readLeb128(data, offset);
    offset = length.next;
    if (length.value > MAX_OBU_BYTES || length.value > data.length - offset) throw new Error('AV1 OBU payload exceeds bounds or is truncated.');
    const payload = data.subarray(offset, offset + length.value);
    offset += length.value;
    obuCount += 1;
    if (type === 2) {
      temporalUnit += 1;
      temporalDelimiterCount += 1;
      framesByTemporalUnit.set(temporalUnit, 0);
    } else if (type === 3 || type === 6) {
      frameUnitCount += 1;
      if (temporalUnit >= 0) framesByTemporalUnit.set(temporalUnit, (framesByTemporalUnit.get(temporalUnit) || 0) + 1);
    } else if (type === 5) {
      const metadataType = readLeb128(payload, 0);
      if (metadataType.value === 4) {
        if (temporalUnit < 0) throw new Error('Dolby T.35 metadata appeared before a temporal delimiter.');
        if (t35Payloads.length >= MAX_RPU_UNITS) throw new Error('AV1 Dolby RPU count exceeds configured limit.');
        t35Payloads.push(payload.subarray(metadataType.next));
        rpuTemporalUnits.add(temporalUnit);
        rpuUnits.push({ ordinal: rpuUnits.length, temporalUnitIndex: temporalUnit });
      }
    }
  }
  if (offset !== data.length || temporalDelimiterCount === 0 || frameUnitCount === 0 || t35Payloads.length === 0) {
    throw new Error('AV1 stream lacks complete temporal delimiters, frame units, or Dolby RPU metadata.');
  }
  for (const unit of rpuTemporalUnits) {
    if ((framesByTemporalUnit.get(unit) || 0) === 0) throw new Error('Dolby RPU metadata is not aligned with a frame in its temporal unit.');
  }
  // A temporal-unit match alone does not prove per-frame alignment. Fail closed
  // when there are multiple frames, multiple RPUs, or frames without metadata.
  // Frame-header (OBU type 3) and complete-frame (type 6) combinations require
  // deeper frame assembly and must not be treated as signed one-to-one proof.
  for (let unit = 0; unit < temporalDelimiterCount; unit += 1) {
    const frameCount = framesByTemporalUnit.get(unit) || 0;
    const rpuCount = rpuUnits.filter((rpu) => rpu.temporalUnitIndex === unit).length;
    if (frameCount !== 1 || rpuCount !== 1) {
      throw new Error('AV1 Dolby RPU alignment requires exactly one frame and one RPU per temporal unit.');
    }
  }
  return {
    t35Payloads,
    report: {
      obuCount,
      temporalDelimiterCount,
      temporalUnitCount: temporalDelimiterCount,
      frameUnitCount,
      dolbyRpuCount: t35Payloads.length,
      rpuTemporalUnitCount: rpuTemporalUnits.size,
      rpuUnits: rpuUnits.map((unit) => ({ ...unit, frameUnitCount: framesByTemporalUnit.get(unit.temporalUnitIndex) || 0 })),
    },
  };
}

export function extractDolbyRpuFromObuStream(inputValue) {
  const parsed = parseDolbyRpuObuStream(inputValue);
  const rpus = parsed.t35Payloads.map((payload) =>
    regularRpuToHevcUnspec62Nalu(extractDolbyRpuFromT35(payload)));
  return {
    rpuBytes: Buffer.concat(rpus.map((nalu) => Buffer.concat([ANNEX_B_START_CODE, nalu]))),
    report: parsed.report,
  };
}

async function convertT35PayloadWithLibdovi(payload, directory, ordinal, options = {}) {
  const converter = options.converter || process.env.AV1_RPU_CONVERTER_BIN;
  if (!converter) return regularRpuToHevcUnspec62Nalu(extractDolbyRpuFromT35(payload));
  const inputPath = resolve(directory, `t35-${ordinal.toString().padStart(6, '0')}.bin`);
  const outputPath = resolve(directory, `rpu-${ordinal.toString().padStart(6, '0')}.bin`);
  await writeFile(inputPath, payload, { flag: 'wx', mode: 0o600 });
  const { stdout } = await execFileAsync(converter, [inputPath, outputPath], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true,
  });
  const rpu = await readFile(outputPath);
  let lastNonZero = rpu.length - 1;
  while (lastNonZero >= 0 && rpu[lastNonZero] === 0) lastNonZero -= 1;
  if (rpu.length < 27 || rpu.length > 1024 * 1024 || rpu[0] !== 0x7c ||
      rpu[1] !== 0x01 || rpu[2] !== 0x19 || lastNonZero < 0 || rpu[lastNonZero] !== 0x80) {
    throw new Error('libdovi returned an invalid HEVC UNSPEC62 RPU NAL unit.');
  }
  let converterReport;
  try { converterReport = JSON.parse(stdout); } catch {
    throw new Error('libdovi converter returned an invalid report.');
  }
  if (!Number.isInteger(converterReport.profile) || converterReport.profile < 0 ||
      converterReport.profile > 20 || converterReport.rpuByteLength !== rpu.length) {
    throw new Error('libdovi converter report does not match its RPU output.');
  }
  return rpu;
}

async function extractDolbyRpuFromObuStreamWithLibdovi(inputValue, directory, options = {}) {
  const parsed = parseDolbyRpuObuStream(inputValue);
  const rpus = [];
  for (let ordinal = 0; ordinal < parsed.t35Payloads.length; ordinal += 1) {
    rpus.push(await convertT35PayloadWithLibdovi(parsed.t35Payloads[ordinal], directory, ordinal, options));
  }
  return {
    rpuBytes: Buffer.concat(rpus.map((nalu) => Buffer.concat([ANNEX_B_START_CODE, nalu]))),
    report: parsed.report,
  };
}

function parseArgs(argv) {
  const options = { kind: 'obu' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else if (argv[index] === '--kind') options.kind = argv[++index];
    else if (argv[index] === '--ffmpeg') options.ffmpeg = argv[++index];
    else if (argv[index] === '--ffprobe') options.ffprobe = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') options.help = true;
    else throw new Error('Unknown command-line option.');
  }
  if (!options.help && (!options.input || !options.output || !['obu', 't35', 'mp4', 'ivf'].includes(options.kind))) {
    throw new Error('Usage: extract-av1-rpu.mjs --input FILE --output FILE [--kind obu|t35|mp4|ivf] [--ffmpeg PATH] [--ffprobe PATH]');
  }
  return options;
}

async function demuxAv1Container(inputPath, directory, options) {
  const ffprobe = options.ffprobe || process.env.FFPROBE_BIN || 'ffprobe';
  const ffmpeg = options.ffmpeg || process.env.FFMPEG_BIN || 'ffmpeg';
  const { stdout: probe } = await execFileAsync(ffprobe, [
    '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_name',
    '-of', 'default=noprint_wrappers=1:nokey=1', inputPath,
  ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true });
  const codecs = probe.trim().split(/\r?\n/).filter(Boolean);
  if (codecs.length !== 1 || codecs[0] !== 'av1') {
    throw new Error('AV1 container analysis requires exactly one AV1 video track.');
  }
  const obuPath = resolve(directory, 'video.obu');
  await execFileAsync(ffmpeg, [
    '-nostdin', '-v', 'error', '-i', inputPath, '-map', '0:v:0',
    '-c:v', 'copy', '-f', 'obu', obuPath,
  ], { encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024, windowsHide: true });
  const bytes = await readFile(obuPath);
  if (bytes.length === 0 || bytes.length > 512 * 1024 * 1024) {
    throw new Error('Demuxed AV1 OBU stream is empty or exceeds the 512 MiB limit.');
  }
  return bytes;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node extract-av1-rpu.mjs --input FILE --output FILE [--kind obu|t35|mp4|ivf] [--ffmpeg PATH] [--ffprobe PATH]\n');
    return;
  }
  const inputPath = resolve(options.input);
  const inputStat = await stat(inputPath);
  if (!inputStat.isFile() || inputStat.size <= 0 || inputStat.size > 512 * 1024 * 1024) {
    throw new Error('AV1 input file is empty or exceeds the 512 MiB limit.');
  }
  let input = null;
  if (options.kind === 't35' || options.kind === 'obu') input = await readFile(inputPath);
  let rpuBytes, report;
  const converterConfigured = Boolean(process.env.AV1_RPU_CONVERTER_BIN);
  if (options.kind === 't35') {
    const directory = await mkdtemp(resolve(tmpdir(), 'libretv-av1-t35-'));
    try {
      const nalu = converterConfigured
        ? await convertT35PayloadWithLibdovi(input, directory, 0, options)
        : regularRpuToHevcUnspec62Nalu(extractDolbyRpuFromT35(input));
      rpuBytes = Buffer.concat([ANNEX_B_START_CODE, nalu]);
      report = { source: basename(inputPath), extractedRpuCount: 1, inputKind: 'av1-t35-payload', extractionBackend: converterConfigured ? 'libdovi' : 'javascript' };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else if (options.kind === 'obu') {
    if (converterConfigured) {
      const directory = await mkdtemp(resolve(tmpdir(), 'libretv-av1-obu-'));
      try {
        const result = await extractDolbyRpuFromObuStreamWithLibdovi(input, directory, options);
        rpuBytes = result.rpuBytes;
        report = { ...result.report, extractionBackend: 'libdovi' };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    } else {
      const result = extractDolbyRpuFromObuStream(input);
      rpuBytes = result.rpuBytes;
      report = { ...result.report, extractionBackend: 'javascript' };
    }
  } else {
    const directory = await mkdtemp(resolve(tmpdir(), 'libretv-av1-demux-'));
    try {
      const obuBytes = await demuxAv1Container(inputPath, directory, options);
      const result = converterConfigured
        ? await extractDolbyRpuFromObuStreamWithLibdovi(obuBytes, directory, options)
        : extractDolbyRpuFromObuStream(obuBytes);
      rpuBytes = result.rpuBytes;
      report = {
        ...result.report,
        inputKind: options.kind,
        containerDemux: 'ffmpeg-copy',
        extractionBackend: converterConfigured ? 'libdovi' : 'javascript',
        sourceByteLength: inputStat.size,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  await writeFile(resolve(options.output), rpuBytes, { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ ...report, rpuByteLength: rpuBytes.length }, null, 2) + '\n');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write('AV1 Dolby RPU extraction failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
