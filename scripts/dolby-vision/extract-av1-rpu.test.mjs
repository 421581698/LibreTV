import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractDolbyRpuFromObuStream,
  extractDolbyRpuFromT35,
} from './extract-av1-rpu.mjs';

function writeBits(bits, value, count) {
  for (let index = count - 1; index >= 0; index -= 1) bits.push((value >> index) & 1);
}

function writeVariableBits(bits, value, width) {
  const max = 1 << width;
  if (value < max) {
    writeBits(bits, value, width);
    bits.push(0);
    return;
  }
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

function validT35Payload() {
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
  return { bytes: Buffer.concat([Buffer.from([0xb5]), packBits(bits)]), rpu };
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

test('extracts the Dolby provider and EMDF payload into a regular RPU unit', () => {
  const { bytes, rpu } = validT35Payload();
  const extracted = extractDolbyRpuFromT35(bytes);
  assert.equal(extracted[0], 0x19);
  assert.deepEqual(extracted.subarray(1), rpu);
});

test('rejects non-Dolby country/provider identifiers and malformed EMDF', () => {
  const { bytes } = validT35Payload();
  const wrongProvider = Buffer.from(bytes);
  wrongProvider[2] ^= 0x01;
  assert.throws(() => extractDolbyRpuFromT35(wrongProvider), /country\/provider/);
  assert.throws(() => extractDolbyRpuFromT35(bytes.subarray(0, 20)));
});

test('extracts Dolby RPU metadata from a temporally aligned raw AV1 OBU stream', () => {
  const { bytes, rpu } = validT35Payload();
  const stream = Buffer.concat([
    obu(2, Buffer.alloc(0)),
    obu(5, Buffer.concat([leb(4), bytes])),
    obu(6, Buffer.from([0])),
  ]);
  const result = extractDolbyRpuFromObuStream(stream);
  assert.deepEqual(result.rpuBytes, Buffer.concat([Buffer.from([0, 0, 0, 1, 0x19]), rpu]));
  assert.deepEqual(result.report, {
    obuCount: 3,
    temporalDelimiterCount: 1,
    temporalUnitCount: 1,
    frameUnitCount: 1,
    dolbyRpuCount: 1,
    rpuTemporalUnitCount: 1,
    rpuUnits: [{ ordinal: 0, temporalUnitIndex: 0, frameUnitCount: 1 }],
  });
});

test('rejects Dolby metadata without a preceding temporal delimiter or frame', () => {
  const { bytes } = validT35Payload();
  assert.throws(() => extractDolbyRpuFromObuStream(obu(5, Buffer.concat([leb(4), bytes]))), /temporal delimiter/);
  assert.throws(() => extractDolbyRpuFromObuStream(Buffer.concat([
    obu(2, Buffer.alloc(0)),
    obu(5, Buffer.concat([leb(4), bytes])),
  ])), /frame units/);
});
