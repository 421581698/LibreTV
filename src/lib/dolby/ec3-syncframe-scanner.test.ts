import { describe, expect, it } from 'vitest';
import { scanEc3Syncframes } from './ec3-syncframe-scanner';

function ec3Frame(length = 8): Uint8Array {
  const frameSizeCode = length / 2 - 1;
  const frame = new Uint8Array(length);
  frame.set([0x0b, 0x77, (frameSizeCode >> 8) & 7, frameSizeCode & 0xff, 0x34, 0x80]);
  return frame;
}

describe('raw EC-3 syncframe scanner', () => {
  it('extracts bounded candidate offsets and actual header attributes', () => {
    const bytes = new Uint8Array([0xaa, ...ec3Frame(), ...ec3Frame()]);
    const result = scanEc3Syncframes(bytes);
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]).toEqual({
      offset: 1, length: 8, streamType: 0, substreamId: 0,
      sampleRateHz: 48000, blocksPerFrame: 6, channelMode: 2, lfe: false,
    });
    expect(result.frames[1].offset).toBe(9);
    expect(result.remainderOffset).toBe(bytes.length);
  });

  it('retains incomplete candidate data and split sync words', () => {
    const frame = ec3Frame();
    const first = scanEc3Syncframes(frame.subarray(0, 3));
    expect(first.frames).toHaveLength(0);
    expect(first.remainderOffset).toBe(0);
    const joined = new Uint8Array([...frame.subarray(first.remainderOffset, 3), ...frame.subarray(3)]);
    expect(scanEc3Syncframes(joined).frames).toHaveLength(1);
    const split = scanEc3Syncframes(new Uint8Array([0x01, 0x0b]));
    expect(split.remainderOffset).toBe(1);
    expect(scanEc3Syncframes(new Uint8Array([0x01, ...frame.subarray(0, 7)])).remainderOffset).toBe(1);
  });

  it('does not accept AC-3 bsid, reserved stream type, invalid sample rate or fake sync', () => {
    const ac3 = ec3Frame(); ac3[5] = 0x40;
    const reserved = ec3Frame(); reserved[2] = 0xc0;
    const invalidSampleRate = ec3Frame(); invalidSampleRate[4] = 0xf4;
    const bytes = new Uint8Array([...ac3, ...reserved, ...invalidSampleRate, 0x0b, 0x76]);
    expect(scanEc3Syncframes(bytes).frames).toHaveLength(0);
  });

  it('limits frame count and preserves bytes for a subsequent scan', () => {
    const data = new Uint8Array([...ec3Frame(), ...ec3Frame()]);
    const result = scanEc3Syncframes(data, 1);
    expect(result.frames).toHaveLength(1);
    expect(result.limitReached).toBe(true);
    expect(result.remainderOffset).toBe(8);
    expect(scanEc3Syncframes(data.subarray(result.remainderOffset)).frames).toHaveLength(1);
    expect(() => scanEc3Syncframes(data, 0)).toThrow(RangeError);
    expect(() => scanEc3Syncframes(data, 4097)).toThrow(RangeError);
  });

  it('never treats random bytes as proof of JOC, decoding or Atmos rendering', () => {
    const result = scanEc3Syncframes(new Uint8Array([0x0b, 0x77, 0x00, 0x03, 0x34, 0x80]));
    expect(result.frames).toHaveLength(0); // header advertises an 8-byte frame; only 6 bytes present
  });
});
