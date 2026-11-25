import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { parseFmp4InitSegment } from './fmp4-fragment-parser';
import { JocCmafPacketExtractor } from './joc-cmaf-packets';
import { parseEc3SpecificBox, type Ec3SpecificConfig } from './joc-dec3-config';

interface Mp4Box {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function topLevelBoxes(bytes: Uint8Array): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const size32 = readU32(bytes, offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    let size = size32;
    let header = 8;
    if (size32 === 1) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const large = view.getBigUint64(offset + 8, false);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 box exceeds the safe parser range.');
      size = Number(large);
      header = 16;
    } else if (size32 === 0) {
      size = bytes.byteLength - offset;
    }
    if (size < header || offset + size > bytes.byteLength) throw new Error(`Invalid top-level MP4 box: ${type}`);
    boxes.push({ type, start: offset, end: offset + size });
    offset += size;
  }
  if (offset !== bytes.byteLength) throw new Error('MP4 fixture ends with an incomplete top-level box.');
  return boxes;
}

function fn<T extends (...args: never[]) => unknown>(exports: Record<string, unknown>, name: string): T {
  const value = exports[name];
  if (typeof value !== 'function') throw new Error(`Missing OpenJOC WASM export: ${name}`);
  return value as T;
}

function nestedBoxes(bytes: Uint8Array, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size = readU32(bytes, offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (size < 8 || offset + size > end) throw new Error(`Invalid nested MP4 box: ${type}`);
    boxes.push({ type, start: offset, end: offset + size });
    offset += size;
  }
  if (offset !== end) throw new Error('Nested MP4 boxes do not fill their parent.');
  return boxes;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, false);
}

function encodeJocDec3(config: Ec3SpecificConfig): Uint8Array {
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let shift = width - 1; shift >= 0; shift -= 1) bits.push((value >> shift) & 1);
  };
  push(config.dataRateKbps, 13);
  push(config.independentSubstreams.length - 1, 3);
  for (const substream of config.independentSubstreams) {
    push(substream.fscod, 2);
    push(substream.bsid, 5);
    push(0, 1);
    push(substream.asvc ? 1 : 0, 1);
    push(substream.bsmod, 3);
    push(substream.acmod, 3);
    push(substream.lfeOn ? 1 : 0, 1);
    push(0, 3);
    push(substream.dependentSubstreams, 4);
    if (substream.dependentSubstreams > 0) push(substream.chanLoc ?? 0, 9);
    else push(0, 1);
  }
  push(0, 7);
  push(1, 1); // CMAF JOC type-A extension signal
  push(16, 8); // supported complexity index
  while (bits.length % 8) bits.push(0);
  const payload = new Uint8Array(bits.length / 8);
  bits.forEach((bit, index) => { payload[index >> 3] |= bit << (7 - (index & 7)); });
  const result = new Uint8Array(payload.length + 8);
  writeU32(result, 0, result.length);
  result.set([0x64, 0x65, 0x63, 0x33], 4);
  result.set(payload, 8);
  return result;
}

/**
 * FFmpeg remuxes the upstream Atmos E-AC-3 elementary fixture but emits an
 * ordinary dec3 reserved byte instead of the CMAF JOC type-A extension.
 * Upgrade only this test fixture's dec3 metadata; preserve the original
 * independent/dependent substream fields and adjust ancestor box sizes.
 */
function addCmafJocDec3Extension(init: Uint8Array): Uint8Array {
  const moov = topLevelBoxes(init).find(box => box.type === 'moov');
  if (!moov) throw new Error('CMAF init fixture is missing moov.');
  const trak = nestedBoxes(init, moov.start + 8, moov.end).find(box => box.type === 'trak');
  if (!trak) throw new Error('CMAF init fixture is missing trak.');
  const mdia = nestedBoxes(init, trak.start + 8, trak.end).find(box => box.type === 'mdia');
  if (!mdia) throw new Error('CMAF init fixture is missing mdia.');
  const minf = nestedBoxes(init, mdia.start + 8, mdia.end).find(box => box.type === 'minf');
  if (!minf) throw new Error('CMAF init fixture is missing minf.');
  const stbl = nestedBoxes(init, minf.start + 8, minf.end).find(box => box.type === 'stbl');
  if (!stbl) throw new Error('CMAF init fixture is missing stbl.');
  const stsd = nestedBoxes(init, stbl.start + 8, stbl.end).find(box => box.type === 'stsd');
  if (!stsd) throw new Error('CMAF init fixture is missing stsd.');
  const entries = nestedBoxes(init, stsd.start + 16, stsd.end);
  const ec3 = entries.find(box => box.type === 'ec-3');
  if (!ec3) throw new Error('CMAF init fixture is missing ec-3 sample entry.');
  const children = nestedBoxes(init, ec3.start + 8 + 28, ec3.end);
  const dec3 = children.find(box => box.type === 'dec3');
  if (!dec3) throw new Error('CMAF init fixture is missing dec3.');
  const config = parseEc3SpecificBox(init.subarray(dec3.start, dec3.end));
  if (config.flagEc3ExtensionTypeA) return init;
  const replacement = encodeJocDec3(config);
  const delta = replacement.length - (dec3.end - dec3.start);
  const patched = new Uint8Array(init.length + delta);
  patched.set(init.subarray(0, dec3.start));
  patched.set(replacement, dec3.start);
  patched.set(init.subarray(dec3.end), dec3.start + replacement.length);
  for (const parent of [ec3, stsd, stbl, minf, mdia, trak, moov]) {
    writeU32(patched, parent.start, readU32(init, parent.start) + delta);
  }
  return patched;
}

/**
 * FFmpeg's raw E-AC-3 demuxer omits access-unit durations in this short
 * elementary-stream fixture. The fixture contains 1536-sample E-AC-3 AUs;
 * set that known duration in trex/tfhd/trun so the CMAF parser receives a
 * standards-shaped sample timeline rather than guessing from codec labels.
 */
function setKnownEac3AccessUnitDuration(init: Uint8Array, segment: Uint8Array, duration: number): void {
  const initMoov = topLevelBoxes(init).find(box => box.type === 'moov');
  if (!initMoov) throw new Error('CMAF init fixture is missing moov.');
  const mvex = nestedBoxes(init, initMoov.start + 8, initMoov.end).find(box => box.type === 'mvex');
  if (!mvex) throw new Error('CMAF init fixture is missing mvex.');
  const trex = nestedBoxes(init, mvex.start + 8, mvex.end).find(box => box.type === 'trex');
  if (!trex) throw new Error('CMAF init fixture is missing trex.');
  writeU32(init, trex.start + 20, duration);

  for (const moof of topLevelBoxes(segment).filter(box => box.type === 'moof')) {
    const traf = nestedBoxes(segment, moof.start + 8, moof.end).find(box => box.type === 'traf');
    if (!traf) throw new Error('CMAF media fixture is missing traf.');
    const fields = nestedBoxes(segment, traf.start + 8, traf.end);
    const tfhd = fields.find(box => box.type === 'tfhd');
    if (tfhd) {
      const versionFlags = readU32(segment, tfhd.start + 8);
      const flags = versionFlags & 0x00ff_ffff;
      let offset = tfhd.start + 16;
      if (flags & 0x000001) offset += 8;
      if (flags & 0x000002) offset += 4;
      if (flags & 0x000008) writeU32(segment, offset, duration);
    }
    for (const trun of fields.filter(box => box.type === 'trun')) {
      const flags = readU32(segment, trun.start + 8) & 0x00ff_ffff;
      const sampleCount = readU32(segment, trun.start + 12);
      let offset = trun.start + 16;
      if (flags & 0x000001) offset += 4;
      if (flags & 0x000004) offset += 4;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        if (flags & 0x000100) { writeU32(segment, offset, duration); offset += 4; }
        if (flags & 0x000200) offset += 4;
        if (flags & 0x000400) offset += 4;
        if (flags & 0x000800) offset += 4;
      }
    }
  }
}

const cmafFixture = process.env.OPENJOC_CMAF_FIXTURE;
const wasmFixture = process.env.OPENJOC_WASM_PATH;

describe.skipIf(!cmafFixture || !wasmFixture)('OpenJOC real E-AC-3 CMAF integration', () => {
  it('extracts complete CMAF samples and decodes them through the pinned WASM ABI to PCM', async () => {
    const mp4 = new Uint8Array(await readFile(cmafFixture!));
    const wasmBytes = await readFile(wasmFixture!);
    const boxes = topLevelBoxes(mp4);
    const ftyp = boxes.find(box => box.type === 'ftyp');
    const moov = boxes.find(box => box.type === 'moov');
    expect(moov).toBeDefined();
    const initStart = ftyp?.start ?? moov!.start;
    const rawInitBytes = mp4.subarray(initStart, moov!.end).slice();
    const initBytes = addCmafJocDec3Extension(rawInitBytes);
    const init = parseFmp4InitSegment(initBytes);
    const audioTrack = init.tracks.find(track => track.handlerType === 'soun' && track.sampleEntries.includes('ec-3'));
    expect(audioTrack, 'fragmented MP4 contains an E-AC-3 audio track').toBeDefined();
    const extractor = new JocCmafPacketExtractor(audioTrack!.trackId);
    extractor.updateInitSegment(initBytes);

    const mediaSegments: Uint8Array[] = [];
    for (const [index, box] of boxes.entries()) {
      if (box.type !== 'moof') continue;
      const mdat = boxes.slice(index + 1).find(candidate => candidate.type === 'mdat');
      expect(mdat, 'each CMAF moof has a following mdat').toBeDefined();
      const media = mp4.subarray(box.start, mdat!.end).slice();
      setKnownEac3AccessUnitDuration(initBytes, media, 1536);
      mediaSegments.push(media);
    }
    expect(mediaSegments.length).toBeGreaterThan(0);

    const packets = mediaSegments.flatMap(segment => extractor.extractMediaSegment(segment).packets);
    expect(packets.length).toBeGreaterThan(0);
    expect(packets.every(packet => packet.sampleEntry === 'ec-3')).toBe(true);
    console.info('CMAF E-AC-3 samples:', packets.map(packet => ({
      size: packet.bytes.byteLength,
      pts: packet.presentationTime,
      duration: packet.duration,
      streamType: packet.bytes[2] >> 6,
      substreamId: (packet.bytes[2] >> 3) & 7,
    })));

    const instantiated = await WebAssembly.instantiate(wasmBytes, {
      env: { openjoc_wasm_clock_now_ms: () => performance.now() },
    });
    const api = instantiated.instance.exports as unknown as Record<string, unknown>;
    const memory = api.memory;
    expect(memory).toBeInstanceOf(WebAssembly.Memory);
    const wasmMemory = memory as WebAssembly.Memory;
    const create = fn<() => number>(api, 'openjoc_wasm_decoder_create');
    const destroy = fn<(handle: number) => void>(api, 'openjoc_wasm_decoder_destroy');
    const alloc = fn<(length: number) => number>(api, 'openjoc_wasm_alloc');
    const dealloc = fn<(pointer: number, length: number) => void>(api, 'openjoc_wasm_dealloc');
    const push = fn<(handle: number, pointer: number, length: number, pts: bigint, flags: number) => number>(api, 'openjoc_wasm_decoder_push_packet');
    const receive = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_receive_pcm');
    const pcmPointer = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_pcm_ptr');
    const pcmLength = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_pcm_len');
    const pcmSamples = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_pcm_samples');
    const consume = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_consume_pcm');
    const flush = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_flush');
    const sampleRate = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_sample_rate');
    const channels = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_channel_count');
    const profilePointer = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_profile_ptr');
    const profileLength = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_profile_len');
    const decodedUnits = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_decoded_access_units');
    const objectCount = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_object_count');
    const errorPointer = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_error_ptr');
    const errorLength = fn<(handle: number) => number>(api, 'openjoc_wasm_decoder_error_len');

    const handle = create();
    expect(handle).toBeGreaterThan(0);
    const pcmParts: Uint8Array[] = [];
    let totalFrames = 0;
    let totalSamples = 0;
    const drain = () => {
      for (let count = 0; count < 16; count += 1) {
        const available = receive(handle);
        if (available === 0) return;
        expect(available).toBe(1);
        const floatCount = pcmLength(handle);
        const sampleCount = pcmSamples(handle);
        expect(floatCount).toBe(sampleCount * 2);
        expect(sampleRate(handle)).toBe(48_000);
        expect(channels(handle)).toBe(2);
        const copied = new Float32Array(wasmMemory.buffer, pcmPointer(handle), floatCount).slice();
        expect(copied.every(Number.isFinite)).toBe(true);
        pcmParts.push(new Uint8Array(copied.buffer.slice(0)));
        totalFrames += 1;
        totalSamples += sampleCount;
        expect(consume(handle)).toBe(1);
      }
      throw new Error('PCM drain exceeded its per-sample bound.');
    };

    try {
      let packetNumber = 0;
      const fixtureBasePts = BigInt(Math.round(packets[0].presentationTime * 48_000 / packets[0].timescale));
      for (const packet of packets) {
        const pointer = alloc(packet.bytes.byteLength);
        expect(pointer).toBeGreaterThan(0);
        try {
          new Uint8Array(wasmMemory.buffer, pointer, packet.bytes.byteLength).set(packet.bytes);
          // FFmpeg's raw E-AC-3 demuxer assigns 1-tick DTS steps to this
          // elementary fixture. Rebase the generated CMAF test track to its
          // known 1536-sample E-AC-3 access-unit cadence; production playback
          // continues to use the real CMAF PTS and rejects discontinuities.
          const ptsSamples = fixtureBasePts + BigInt(packetNumber * 1536);
          const status = push(handle, pointer, packet.bytes.byteLength, ptsSamples, 0);
          if (status < 0) {
            const errorSize = errorLength(handle);
            const detail = errorSize > 0
              ? new TextDecoder().decode(new Uint8Array(wasmMemory.buffer, errorPointer(handle), errorSize).slice())
              : 'No decoder detail was provided.';
            throw new Error(`OpenJOC rejected CMAF packet ${packetNumber} (sample=${packet.sampleIndex}, size=${packet.bytes.byteLength}, pts=${packet.presentationTime}/${packet.timescale}, streamType=${packet.bytes[2] >> 6}, substream=${(packet.bytes[2] >> 3) & 7}): ${detail}`);
          }
        } finally {
          dealloc(pointer, packet.bytes.byteLength);
        }
        drain();
        packetNumber += 1;
      }

      let reachedEos = false;
      for (let attempt = 0; attempt < 256; attempt += 1) {
        const status = flush(handle);
        expect(status).toBeGreaterThanOrEqual(0);
        drain();
        if (status === 3) {
          reachedEos = true;
          break;
        }
      }
      expect(reachedEos).toBe(true);
      expect(totalFrames).toBeGreaterThan(0);
      expect(totalSamples).toBeGreaterThan(0);
      expect(pcmParts.some(part => part.some(value => value !== 0))).toBe(true);
      expect(decodedUnits(handle)).toBeGreaterThan(0);
      const profileSize = profileLength(handle);
      expect(profileSize).toBeGreaterThan(0);
      const profile = new TextDecoder().decode(
        new Uint8Array(wasmMemory.buffer, profilePointer(handle), profileSize).slice(),
      );
      expect(profile.length).toBeGreaterThan(0);
      expect(objectCount(handle)).not.toBe(0xffff_ffff);
      const pcmHash = createHash('sha256').update(Buffer.concat(pcmParts.map(part => Buffer.from(part)))).digest('hex');
      expect(pcmHash).toMatch(/^[a-f0-9]{64}$/);
      console.info(`OpenJOC CMAF integration: ${packets.length} samples, ${decodedUnits(handle)} access units, ${totalSamples} PCM frames, profile=${profile}, SHA256=${pcmHash}`);
    } finally {
      destroy(handle);
    }
  });
});
