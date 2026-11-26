import { describe, expect, it } from 'vitest';
import { scanAc3Syncframes } from './ac3-syncframe-scanner';

function frame(fscod: 0 | 1 | 2, frameSizeCode: number): Uint8Array {
  const bitrate = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640][frameSizeCode >> 1];
  const words44100 = [69, 87, 104, 121, 139, 174, 208, 243, 278, 348, 417, 487, 557, 696, 835, 975, 1114, 1253, 1393];
  const length = 2 * (fscod === 0 ? bitrate * 2 : fscod === 1
    ? words44100[frameSizeCode >> 1] + (frameSizeCode & 1) : bitrate * 3);
  const result = new Uint8Array(length);
  result.set([0x0b, 0x77, 0, 0, (fscod << 6) | frameSizeCode, 0x40, 0x40]);
  return result;
}

describe('canonical clear AC-3 raw frame scanner', () => {
  it('recognizes canonical 48, 44.1 and 32 kHz frame sizes without decoding', () => {
    const frames = [frame(0, 0), frame(1, 1), frame(2, 36)];
    const input = Uint8Array.from([0xaa, ...frames.flatMap(x => Array.from(x))]);
    const found = scanAc3Syncframes(input);
    expect(found.frames.map(f => [f.sampleRateHz, f.length, f.bitRateKbps])).toEqual([
      [48000, 128, 32], [44100, 140, 32], [32000, 3456, 576],
    ]);
    expect(found.remainderOffset).toBe(input.length);
    expect(found.frames[0].channelMode).toBe(2);
    expect(found.frames[0].bsid).toBe(8);
  });
  it('retains partial frame and split sync headers for streaming', () => {
    const full = frame(0, 0);
    const partial = scanAc3Syncframes(full.subarray(0, 7));
    expect(partial.remainderOffset).toBe(0);
    expect(scanAc3Syncframes(Uint8Array.from([1, 2, 0x0b])).remainderOffset).toBe(2);
    expect(scanAc3Syncframes(full).frames).toHaveLength(1);
  });
  it('rejects E-AC-3, reserved AC-3 codes, and invalid frame-count limits', () => {
    const ec3 = frame(0, 0); ec3[5] = 0x80;
    const reserved = frame(0, 0); reserved[4] = 0x3f;
    const badRate = frame(0, 0); badRate[4] = 0xc0;
    expect(scanAc3Syncframes(Uint8Array.from([...ec3, ...reserved, ...badRate])).frames).toHaveLength(0);
    expect(() => scanAc3Syncframes(new Uint8Array(0), 0)).toThrow(RangeError);
    expect(() => scanAc3Syncframes(new Uint8Array(0), 4097)).toThrow(RangeError);
  });
  it('preserves the unprocessed frames when the requested limit is reached', () => {
    const input = Uint8Array.from([...frame(0, 0), ...frame(0, 0)]);
    const first = scanAc3Syncframes(input, 1);
    expect(first.frames).toHaveLength(1);
    expect(first.limitReached).toBe(true);
    expect(first.remainderOffset).toBe(128);
    expect(scanAc3Syncframes(input.subarray(first.remainderOffset)).frames).toHaveLength(1);
  });
});
