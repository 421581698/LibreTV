import { describe, expect, it } from 'vitest';
import { Ec3TsPesExtractor } from './ec3-ts-pes';
function packet(cc = 0) {
  const p = new Uint8Array(188).fill(255);
  p.set([0x47, 0x41, 0, 0x10 | cc, 0, 0, 1, 0xbd, 0, 5, 0x80, 0, 0, 0x0b, 0x77]);
  return p;
}
describe('clear TS audio PES', () => {
  it('extracts bounded selected PID payload without stuffing', () => {
    const parser = new Ec3TsPesExtractor(256);
    expect(parser.push(packet())).toBeNull();
    expect(parser.finish()).toEqual({ bytes: Uint8Array.of(11,119), pts90k: null });
  });
  it('rejects continuity loss and scrambling', () => {
    const parser = new Ec3TsPesExtractor(256);
    parser.push(packet());
    expect(() => parser.push(packet(2))).toThrow();
    const scrambled = packet();
    scrambled[3] |= 128;
    expect(() => parser.push(scrambled)).toThrow();
  });
});
