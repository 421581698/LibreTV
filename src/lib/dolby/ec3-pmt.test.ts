import { describe, expect, it } from 'vitest';
import { findEc3Pid } from './ec3-pmt';
function pmt(streams: number[]) {
  const n = 13 + streams.length;
  return Uint8Array.of(2, 0xb0, n, 0, 1, 0xc1, 0, 0, 0xe1, 0, 0xf0, 0, ...streams, 0, 0, 0, 0);
}
describe('EC-3 PMT inspection', () => {
  it('recognizes explicit EC-3 and private stream descriptor', () => {
    expect(findEc3Pid(pmt([0x87, 0xe1, 0, 0xf0, 0]))).toBe(256);
    expect(findEc3Pid(pmt([6, 0xe1, 1, 0xf0, 3, 0x7a, 1, 0]))).toBe(257);
  });
  it('rejects ambiguous or truncated streams', () => {
    expect(() => findEc3Pid(pmt([0x87, 0xe1, 0, 0xf0, 0, 0x87, 0xe1, 1, 0xf0, 0]))).toThrow();
    expect(() => findEc3Pid(pmt([6, 0xe1, 0, 0xf0, 4]))).toThrow();
    expect(findEc3Pid(pmt([0x0f, 0xe1, 0, 0xf0, 0]))).toBeNull();
  });
});
