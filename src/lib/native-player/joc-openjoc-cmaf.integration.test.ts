import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { parseFmp4InitSegment } from './fmp4-fragment-parser';
import { JocCmafPacketExtractor } from './joc-cmaf-packets';

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
    const initBytes = mp4.subarray(initStart, moov!.end);
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
      mediaSegments.push(mp4.subarray(box.start, mdat!.end));
    }
    expect(mediaSegments.length).toBeGreaterThan(0);

    const packets = mediaSegments.flatMap(segment => extractor.extractMediaSegment(segment).packets);
    expect(packets.length).toBeGreaterThan(0);
    expect(packets.every(packet => packet.sampleEntry === 'ec-3')).toBe(true);

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
      for (const packet of packets) {
        const pointer = alloc(packet.bytes.byteLength);
        expect(pointer).toBeGreaterThan(0);
        try {
          new Uint8Array(wasmMemory.buffer, pointer, packet.bytes.byteLength).set(packet.bytes);
          const ptsSamples = BigInt(Math.round(packet.presentationTime * 48_000 / packet.timescale));
          const status = push(handle, pointer, packet.bytes.byteLength, ptsSamples, 0);
          expect(status).toBeGreaterThanOrEqual(0);
        } finally {
          dealloc(pointer, packet.bytes.byteLength);
        }
        drain();
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
