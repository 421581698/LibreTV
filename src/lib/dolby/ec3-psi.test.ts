import { describe, expect, it } from 'vitest';
import { discoverEc3Pid, validPsiCrc } from './ec3-psi';
function packet(pid: number, body: number[]) {
  let crc = 0xffffffff;
  for (const b of body) {
    crc ^= b << 24;
    for (let i = 0; i < 8; i++) crc = (crc << 1) ^ ((crc & 0x80000000) ? 0x04c11db7 : 0);
  }
  const p = new Uint8Array(188).fill(255);
  p.set([0x47, 0x40 | (pid >> 8), pid & 255, 0x10, 0, ...body, crc >>> 24, crc >>> 16 & 255, crc >>> 8 & 255, crc & 255]);
  return p;
}
describe('EC-3 PSI discovery', () => {
  const pat = packet(0, [0,0xb0,13,0,1,0xc1,0,0,0,1,0xe1,0]);
  const pmt = packet(256, [2,0xb0,18,0,1,0xc1,0,0,0xe1,1,0xf0,0,0x87,0xe1,1,0xf0,0]);
  it('discovers the EC-3 PID from CRC-valid PAT and PMT', () => {
    expect(validPsiCrc(pat.subarray(5,21))).toBe(true);
    expect(discoverEc3Pid(Uint8Array.from([...pat,...pmt]))).toBe(257);
  });
  it('rejects corrupt PSI and returns null for absent PMT', () => {
    const corrupt = pmt.slice(); corrupt[15] ^= 1;
    expect(() => discoverEc3Pid(Uint8Array.from([...pat,...corrupt]))).toThrow();
    expect(discoverEc3Pid(pat)).toBeNull();
  });
});
