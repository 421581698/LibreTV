/** Bounded clear MPEG-TS PES extraction for a caller-verified EC-3 PID.
 * No PAT/PMT discovery, decryption, or JOC detection. Reject discontinuities.
 */
export interface Ec3Pes { bytes: Uint8Array; pts90k: number | null }
const MAX_PES = 256 * 1024;
export class Ec3TsPesExtractor {
  private parts: Uint8Array[] = [];
  private size = 0;
  private counter: number | null = null;
  constructor(private readonly pid: number) {
    if (!Number.isInteger(pid) || pid < 32 || pid >= 8191) throw new RangeError('Invalid audio PID');
  }
  reset() { this.parts = []; this.size = 0; this.counter = null; }
  push(packet: Uint8Array): Ec3Pes | null {
    if (packet.length !== 188 || packet[0] !== 0x47) throw new Error('Invalid TS packet');
    if (((packet[1] & 31) << 8 | packet[2]) !== this.pid) return null;
    if ((packet[1] & 128) || (packet[3] & 192)) { this.reset(); throw new Error('Corrupt or scrambled TS'); }
    const control = (packet[3] >> 4) & 3;
    if (!control) throw new Error('Invalid adaptation control');
    let offset = 4;
    if (control & 2) {
      const length = packet[4];
      offset = 5 + length;
      if (offset > 188 || (length && (packet[5] & 128))) { this.reset(); throw new Error('TS discontinuity'); }
    }
    if (!(control & 1)) return null;
    if (offset === 188) { this.reset(); throw new Error('Missing TS payload'); }
    const cc = packet[3] & 15;
    if (this.counter !== null && cc !== ((this.counter + 1) & 15)) { this.reset(); throw new Error('TS continuity mismatch'); }
    this.counter = cc;
    const start = Boolean(packet[1] & 64);
    const previous = start ? this.finish() : null;
    if (!start && !this.size) return null;
    const payload = packet.slice(offset);
    this.size += payload.length;
    if (this.size > MAX_PES) { this.reset(); throw new Error('PES size limit'); }
    this.parts.push(payload);
    return previous;
  }
  finish(): Ec3Pes | null {
    if (!this.size) return null;
    const data = new Uint8Array(this.size);
    let offset = 0;
    for (const part of this.parts) { data.set(part, offset); offset += part.length; }
    this.parts = []; this.size = 0;
    if (data.length < 9 || data[0] || data[1] || data[2] !== 1 || (data[6] & 192) !== 128) throw new Error('Invalid PES header');
    if (data[3] !== 0xbd || (data[6] & 0x30) !== 0 || (data[7] & 0x3f) !== 0) throw new Error('Unsupported PES header');
    const length = (data[4] << 8) | data[5];
    const end = length ? length + 6 : data.length;
    const start = 9 + data[8];
    if (!length || end > data.length || start >= end) throw new Error('Incomplete or unbounded audio PES');
    let pts90k: number | null = null;
    const flags = data[7] >> 6;
    if (flags === 1) throw new Error('Invalid PES timestamp flags');
    if (flags >= 2) {
      if (data[8] < (flags === 3 ? 10 : 5) || (data[9] >> 4) !== flags || !(data[9] & 1) || !(data[11] & 1) || !(data[13] & 1)) throw new Error('Invalid PTS');
      pts90k = (data[9] & 14) * 536870912 + data[10] * 4194304 + (data[11] & 254) * 16384 + data[12] * 128 + (data[13] >> 1);
    }
    return { bytes: data.slice(start, end), pts90k };
  }
}
