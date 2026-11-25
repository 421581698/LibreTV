#!/usr/bin/env node
/**
 * Strict Dolby Vision AV1 T.35 / EMDF extractor.
 * Accepts one AV1 T.35 metadata payload or a raw low-overhead AV1 OBU stream.
 * This is not an AV1 container demuxer or a video decoder.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const T35_HEADER = Buffer.from([0x00, 0x3b, 0x00, 0x00, 0x08, 0x00, 0x37, 0xcd, 0x08]);
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

export function extractDolbyRpuFromObuStream(inputValue) {
  const data = Buffer.from(inputValue);
  const rpus = [];
  const rpuTemporalUnits = new Set();
  let offset = 0, obuCount = 0, temporalUnit = -1, temporalDelimiterCount = 0, frameUnitCount = 0;
  const framesByTemporalUnit = new Map();
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
        if (rpus.length >= MAX_RPU_UNITS) throw new Error('AV1 Dolby RPU count exceeds configured limit.');
        rpus.push(extractDolbyRpuFromT35(payload.subarray(metadataType.next)));
        rpuTemporalUnits.add(temporalUnit);
      }
    }
  }
  if (offset !== data.length || temporalDelimiterCount === 0 || frameUnitCount === 0 || rpus.length === 0) {
    throw new Error('AV1 stream lacks complete temporal delimiters, frame units, or Dolby RPU metadata.');
  }
  for (const unit of rpuTemporalUnits) {
    if ((framesByTemporalUnit.get(unit) || 0) === 0) throw new Error('Dolby RPU metadata is not aligned with a frame in its temporal unit.');
  }
  return {
    rpuBytes: Buffer.concat(rpus),
    report: { obuCount, temporalDelimiterCount, temporalUnitCount: temporalDelimiterCount, frameUnitCount, dolbyRpuCount: rpus.length, rpuTemporalUnitCount: rpuTemporalUnits.size },
  };
}

function parseArgs(argv) {
  const options = { kind: 'obu' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else if (argv[index] === '--kind') options.kind = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') options.help = true;
    else throw new Error('Unknown command-line option.');
  }
  if (!options.help && (!options.input || !options.output || !['obu', 't35'].includes(options.kind))) {
    throw new Error('Usage: extract-av1-rpu.mjs --input FILE --output FILE [--kind obu|t35]');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write('Usage: node extract-av1-rpu.mjs --input FILE --output FILE [--kind obu|t35]\n'); return; }
  const input = await readFile(resolve(options.input));
  let rpuBytes, report;
  if (options.kind === 't35') {
    rpuBytes = extractDolbyRpuFromT35(input);
    report = { source: basename(options.input), extractedRpuCount: 1, inputKind: 'av1-t35-payload' };
  } else {
    const result = extractDolbyRpuFromObuStream(input);
    rpuBytes = result.rpuBytes;
    report = result.report;
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
