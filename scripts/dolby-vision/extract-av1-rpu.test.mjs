import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  extractDolbyRpuFromObuStream,
  extractDolbyRpuFromT35,
  regularRpuToHevcUnspec62Nalu,
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
  assert.deepEqual(result.rpuBytes, Buffer.concat([
    Buffer.from([0, 0, 0, 1, 0x7c, 0x01, 0x19]),
    rpu,
  ]));
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


test('inserts HEVC emulation-prevention bytes in the UNSPEC62 RPU NAL unit', () => {
  const nalu = regularRpuToHevcUnspec62Nalu(Buffer.from([0x19, 0x00, 0x00, 0x01, 0x80, 0x55, 0x66]));
  assert.deepEqual(nalu, Buffer.from([0x7c, 0x01, 0x19, 0x00, 0x00, 0x03, 0x01, 0x80, 0x55, 0x66]));
});


test('demuxes one AV1 video track from MP4 without re-encoding', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'libretv-av1-container-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { bytes } = validT35Payload();
  const obuFixture = Buffer.concat([
    obu(2, Buffer.alloc(0)),
    obu(5, Buffer.concat([leb(4), bytes])),
    obu(6, Buffer.from([0])),
  ]);
  const fixturePath = resolve(directory, 'fixture.obu');
  const inputPath = resolve(directory, 'input.container');
  const ffprobePath = resolve(directory, 'ffprobe');
  const ffmpegPath = resolve(directory, 'ffmpeg');
  await writeFile(fixturePath, obuFixture);
  await writeFile(inputPath, Buffer.from('container fixture'));
  await writeFile(ffprobePath, `#!/usr/bin/env node
process.stdout.write(process.env.TEST_AV1_STREAMS || "av1\\n");
`);
  await writeFile(ffmpegPath, `#!/usr/bin/env node
const fs=require("node:fs"); if(!process.argv.includes("-xerror") || process.argv.includes("-fs") || process.argv.at(-1)!=="pipe:1") process.exit(3); process.stdout.write(fs.readFileSync(process.env.TEST_AV1_OBU_FIXTURE)); if(process.env.TEST_DEMUX_FAIL==="1") process.exitCode=1;
`);
  await chmod(ffprobePath, 0o755);
  await chmod(ffmpegPath, 0o755);

  // A demuxer may write a valid prefix but fail before signaling completion.
  // A killed/failed process must never publish a seemingly valid RPU file.
  const outputPath = resolve(directory, 'mp4.rpu');
  execFileSync(process.execPath, [
    resolve('scripts/dolby-vision/extract-av1-rpu.mjs'),
    '--kind', 'mp4', '--input', inputPath, '--output', outputPath,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FFPROBE_BIN: ffprobePath,
      FFMPEG_BIN: ffmpegPath,
      TEST_AV1_OBU_FIXTURE: fixturePath,
      TEST_AV1_STREAMS: 'av1\n',
      AV1_RPU_CONVERTER_BIN: '',
    },
    stdio: 'pipe',
  });
  const output = await readFile(outputPath);
  assert.deepEqual(output, Buffer.concat([
    Buffer.from([0, 0, 0, 1, 0x7c, 0x01, 0x19]),
    Buffer.alloc(21, 0x55),
    Buffer.from([0x80]),
  ]));

  const partialOutput = resolve(directory, 'partial.rpu');
  assert.throws(() => execFileSync(process.execPath, [
    resolve('scripts/dolby-vision/extract-av1-rpu.mjs'),
    '--kind', 'mp4', '--input', inputPath, '--output', partialOutput,
  ], { env: { ...process.env, FFPROBE_BIN: ffprobePath, FFMPEG_BIN: ffmpegPath,
    TEST_AV1_OBU_FIXTURE: fixturePath, TEST_AV1_STREAMS: 'av1\n',
    TEST_DEMUX_FAIL: '1', AV1_RPU_CONVERTER_BIN: '' }, stdio: 'pipe' }),
  /AV1 demux failed before complete output was obtained/);
  await assert.rejects(readFile(partialOutput), { code: 'ENOENT' });

  const rejectedOutput = resolve(directory, 'ambiguous.rpu');
  assert.throws(() => execFileSync(process.execPath, [
    resolve('scripts/dolby-vision/extract-av1-rpu.mjs'),
    '--kind', 'mp4', '--input', inputPath, '--output', rejectedOutput,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FFPROBE_BIN: ffprobePath,
      FFMPEG_BIN: ffmpegPath,
      TEST_AV1_OBU_FIXTURE: fixturePath,
      TEST_AV1_STREAMS: 'av1\nav1\n',
      AV1_RPU_CONVERTER_BIN: '',
    },
    stdio: 'pipe',
  }));
});

test('rejects Dolby metadata without a preceding temporal delimiter or frame', () => {
  const { bytes } = validT35Payload();
  assert.throws(() => extractDolbyRpuFromObuStream(obu(5, Buffer.concat([leb(4), bytes]))), /temporal delimiter/);
  assert.throws(() => extractDolbyRpuFromObuStream(Buffer.concat([
    obu(2, Buffer.alloc(0)),
    obu(5, Buffer.concat([leb(4), bytes])),
  ])), /frame units/);
});

test('fails closed when AV1 temporal-unit counts do not prove one-to-one RPU alignment', () => {
  const { bytes } = validT35Payload();
  const metadata = obu(5, Buffer.concat([leb(4), bytes]));
  const delimiter = obu(2, Buffer.alloc(0));
  const frame = obu(6, Buffer.from([0]));
  const invalidStreams = [
    Buffer.concat([delimiter, metadata, metadata, frame]),
    Buffer.concat([delimiter, metadata, frame, frame]),
    Buffer.concat([delimiter, metadata, frame, delimiter, frame]),
  ];
  for (const stream of invalidStreams) {
    assert.throws(() => extractDolbyRpuFromObuStream(stream), /exactly one frame and one RPU/);
  }
});

test('rejects an orphan AV1 frame before an otherwise aligned temporal unit', () => {
  const { bytes } = validT35Payload();
  const frame = obu(6, Buffer.from([0]));
  const stream = Buffer.concat([
    frame, obu(2, Buffer.alloc(0)),
    obu(5, Buffer.concat([leb(4), bytes])), frame,
  ]);
  assert.throws(() => extractDolbyRpuFromObuStream(stream), /frame appeared before a temporal delimiter/);
});


test('rejects malformed AV1 temporal delimiters before accepting RPU alignment', () => {
  const { bytes } = validT35Payload();
  const metadata = obu(5, Buffer.concat([leb(4), bytes]));
  const frame = obu(6, Buffer.from([0]));
  for (const delimiter of [obu(2, Buffer.from([0])), Buffer.from([0x16, 0, 0])]) {
    assert.throws(() => extractDolbyRpuFromObuStream(Buffer.concat([delimiter, metadata, frame])), /temporal delimiter must have an empty payload and no extension header/);
  }
});

test('rejects empty and oversized demux output without producing RPU evidence', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'libretv-av1-demux-bound-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = resolve(directory, 'input.mp4');
  const probe = resolve(directory, 'ffprobe');
  const demux = resolve(directory, 'ffmpeg');
  await writeFile(input, 'fixture');
  await writeFile(probe, '#!/usr/bin/env node\nconsole.log("av1");\n', { mode: 0o755 });
  await writeFile(demux, '#!/usr/bin/env node\nconst size = Number(process.env.TEST_DEMUX_SIZE); const chunk = Buffer.alloc(1024 * 1024); let remaining = size; function pump() { while (remaining > 0) { const n = Math.min(remaining, chunk.length); remaining -= n; if (!process.stdout.write(chunk.subarray(0,n))) { process.stdout.once("drain", pump); return; } } } pump();\n', { mode: 0o755 });
  for (const size of [0, 512 * 1024 * 1024, 512 * 1024 * 1024 + 1]) {
    const output = resolve(directory, size + '.rpu');
    assert.throws(() => execFileSync(process.execPath, [resolve('scripts/dolby-vision/extract-av1-rpu.mjs'), '--kind', 'mp4', '--input', input, '--output', output], {
      env: { ...process.env, FFPROBE_BIN: probe, FFMPEG_BIN: demux, TEST_DEMUX_SIZE: String(size), AV1_RPU_CONVERTER_BIN: '' }, stdio: 'pipe',
    }), /Demuxed AV1 OBU stream is empty or exceeds the 512 MiB limit/);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});

test('rejects invalid libdovi output sizes without publishing RPU evidence', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'libretv-av1-converter-bound-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = resolve(directory, 'input.t35');
  const converter = resolve(directory, 'converter');
  await writeFile(input, validT35Payload().bytes);
  await writeFile(converter, '#!/usr/bin/env node\nconst fs = require("node:fs"); const p = process.argv.at(-1); fs.writeFileSync(p, ""); fs.truncateSync(p, Number(process.env.TEST_RPU_SIZE));\n', { mode: 0o755 });
  for (const size of [0, 26, 1024 * 1024 + 1]) {
    const output = resolve(directory, size + '.rpu');
    assert.throws(() => execFileSync(process.execPath, [
      resolve('scripts/dolby-vision/extract-av1-rpu.mjs'), '--kind', 't35', '--input', input, '--output', output,
    ], {
      env: { ...process.env, AV1_RPU_CONVERTER_BIN: converter, TEST_RPU_SIZE: String(size) },
      stdio: 'pipe',
    }), /libdovi returned an invalid HEVC UNSPEC62 RPU NAL unit/);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});


test('bounds temporal unit bookkeeping before allocating unbounded alignment records', () => {
  const delimiter = obu(2, Buffer.alloc(0));
  const input = Buffer.concat(Array(100001).fill(delimiter));
  assert.throws(() => extractDolbyRpuFromObuStream(input), /temporal unit count exceeds configured limit/);
});

test('bounds frame unit bookkeeping independently of metadata count', () => {
  const delimiter = obu(2, Buffer.alloc(0));
  const frame = obu(6, Buffer.from([0]));
  const input = Buffer.concat([delimiter, ...Array(100001).fill(frame)]);
  assert.throws(() => extractDolbyRpuFromObuStream(input), /frame unit count exceeds configured limit/);
});

test('rejects oversized T.35 metadata before conversion', () => {
  const input = Buffer.concat([
    obu(2, Buffer.alloc(0)),
    obu(5, Buffer.concat([leb(4), Buffer.alloc(1024 * 1024 + 1)])),
    obu(6, Buffer.from([0])),
  ]);
  assert.throws(() => extractDolbyRpuFromObuStream(input), /T\.35 metadata exceeds configured byte limit/);
});

test('reads an OBU size across file chunks and rejects a truncated payload', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'libretv-av1-chunk-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { bytes } = validT35Payload();
  const fixture = Buffer.concat([
    obu(2, Buffer.alloc(0)),
    obu(15, Buffer.alloc(64 * 1024 - 8)),
    obu(5, Buffer.concat([leb(4), bytes, Buffer.alloc(128)])),
    obu(6, Buffer.alloc(128)),
  ]);
  const input = resolve(directory, 'input.obu');
  const output = resolve(directory, 'output.rpu');
  const script = new URL('./extract-av1-rpu.mjs', import.meta.url);
  const args = [decodeURIComponent(script.pathname), '--input', input, '--output', output];
  await writeFile(input, fixture);
  execFileSync(process.execPath, args, { stdio: 'pipe' });
  assert.deepEqual(await readFile(output), extractDolbyRpuFromObuStream(fixture).rpuBytes);
  await rm(output);
  await writeFile(input, fixture.subarray(0, -1));
  assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }), /payload exceeds bounds or is truncated/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('associates IVF RPU records with their packet PTS and exact time base', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'libretv-ivf-timing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const header = Buffer.alloc(32);
  header.write('DKIF');
  header.writeUInt16LE(32, 6);
  header.write('AV01', 8);
  header.writeUInt32LE(30000, 16);
  header.writeUInt32LE(1001, 20);
  const { bytes } = validT35Payload();
  const unit = Buffer.concat([obu(5, Buffer.concat([leb(4), bytes])), obu(6, Buffer.from([0]))]);
  const delimiter = obu(2, Buffer.alloc(0));
  function packet(pts, payload) {
    const prefix = Buffer.alloc(12);
    prefix.writeUInt32LE(payload.length);
    prefix.writeBigInt64LE(pts, 4);
    return Buffer.concat([prefix, payload]);
  }
  const first = packet(12n, Buffer.concat([delimiter, unit]));
  const second = packet(9007199254740993n, unit);
  const input = resolve(directory, 'input.ivf');
  const output = resolve(directory, 'output.rpu');
  const args = [resolve('scripts/dolby-vision/extract-av1-rpu.mjs'),
    '--kind', 'ivf', '--input', input, '--output', output];
  await writeFile(input, Buffer.concat([header, first, second]));
  const report = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  assert.equal(report.temporalDelimiterCount, 1);
  assert.equal(report.temporalUnitCount, 2);
  assert.deepEqual(report.packetTimeBase, { numerator: 1001, denominator: 30000 });
  assert.deepEqual(report.rpuUnits.map(({ packetPts }) => packetPts), ['12', '9007199254740993']);
  await rm(output);

  const ambiguous = packet(42n, Buffer.concat([unit, delimiter, unit]));
  await writeFile(input, Buffer.concat([header, ambiguous]));
  assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }), /multiple temporal units/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });

  await writeFile(input, Buffer.concat([header, first, second.subarray(0, -1)]));
  assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }), /Truncated AV1 IVF/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('matches decoded AV1 MP4 frame PTS against packet-bound RPU without accepting mismatch', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'libretv-av1-decoded-frame-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { bytes } = validT35Payload();
  const sample = Buffer.concat([obu(5, Buffer.concat([leb(4), bytes])), obu(6, Buffer.from([0]))]);
  const input = resolve(directory, 'input.mp4');
  const output = resolve(directory, 'output.rpu');
  const probe = resolve(directory, 'ffprobe');
  await writeFile(input, Buffer.concat([sample, sample]));
  await writeFile(probe, '#!/usr/bin/env node\nprocess.stdout.write(process.argv.includes("-show_frames") ? process.env.FRAME_REPORT : process.env.PACKET_REPORT);\n', { mode: 0o755 });
  const packetLine = (pos, pts) => 'packet|stream_index=0|pts=' + pts +
    '|size=' + sample.length + '|pos=' + pos;
  const packetReport = [packetLine(0, '0'), packetLine(sample.length, '3000'),
    'stream|index=0|codec_name=av1|time_base=1/90000'].join('\n');
  const args = [resolve('scripts/dolby-vision/extract-av1-rpu.mjs'), '--kind', 'mp4',
    '--mp4-packet-timing', '--verify-decoded-frames',
    '--ffprobe', probe, '--input', input, '--output', output];
  function run(frameReport) {
    return execFileSync(process.execPath, args, {
      encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, AV1_RPU_CONVERTER_BIN: '', PACKET_REPORT: packetReport, FRAME_REPORT: frameReport },
    });
  }
  const verified = JSON.parse(run(['frame|best_effort_timestamp=3000', 'frame|best_effort_timestamp=0'].join('\n')));
  assert.deepEqual(verified.decodedPresentationAlignment, { scope: 'ffprobe-decoded-frame-pts', matched: true, frameCount: 2 });
  await rm(output);
  for (const report of [
    'frame|best_effort_timestamp=0',
    'frame|best_effort_timestamp=0\nframe|best_effort_timestamp=0',
    'frame|best_effort_timestamp=0\nframe|best_effort_timestamp=999',
    'frame|best_effort_timestamp=N/A\nframe|best_effort_timestamp=3000',
  ]) {
    assert.throws(() => run(report), /AV1 decoded frame/);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});

test('maps MP4 packet PTS by sample byte range and rejects ambiguous ranges', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'libretv-mp4-timing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { bytes } = validT35Payload();
  const sample = Buffer.concat([obu(5, Buffer.concat([leb(4), bytes])), obu(6, Buffer.from([0]))]);
  const input = resolve(directory, 'input.mp4');
  const output = resolve(directory, 'output.rpu');
  const ffprobe = resolve(directory, 'ffprobe');
  await writeFile(input, Buffer.concat([Buffer.alloc(16), sample, sample]));
  await writeFile(ffprobe, '#!/usr/bin/env node\nprocess.stdout.write(process.env.TEST_PACKET_REPORT);\n');
  await chmod(ffprobe, 0o755);

  const args = [resolve('scripts/dolby-vision/extract-av1-rpu.mjs'), '--kind', 'mp4',
    '--mp4-packet-timing', '--ffprobe', ffprobe, '--input', input, '--output', output];
  function run(secondPos, secondPts) {
    const packetLine = (pos, pts) => 'packet|stream_index=0|pts=' + pts +
      '|size=' + sample.length + '|pos=' + pos;
    const report = [
      packetLine(16, '9007199254740993'),
      packetLine(secondPos, secondPts),
      'stream|index=0|codec_name=av1|time_base=1/90000',
    ].join('\n');
    return execFileSync(process.execPath, args, {
      encoding: 'utf8', env: { ...process.env, TEST_PACKET_REPORT: report, AV1_RPU_CONVERTER_BIN: '' },
      stdio: 'pipe',
    });
  }

  const timing = JSON.parse(run(16 + sample.length, '-3003'));
  assert.deepEqual(timing.packetTimeBase, { numerator: 1, denominator: 90000 });
  assert.deepEqual(timing.rpuUnits.map(({ packetPts }) => packetPts), ['9007199254740993', '-3003']);
  await rm(output);
  assert.throws(() => run(16, '12'), /byte ranges overlap/);
  assert.throws(() => run(16 + sample.length, '9007199254740993'), /duplicate PTS/);
  assert.throws(() => run(16 + sample.length, 'N\/A'), /invalid bounds or presentation timestamp/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});
