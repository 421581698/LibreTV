import { findEc3Pid } from './ec3-pmt';

/** MPEG-2 PSI CRC, including the transmitted CRC bytes. */
export function validPsiCrc(section: Uint8Array): boolean {
  let crc = 0xffffffff;
  for (const byte of section) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i++) crc = (crc << 1) ^ ((crc & 0x80000000) ? 0x04c11db7 : 0);
  }
  return crc === 0;
}

/** Single-program, single-packet PSI subset. No guessing or cross-packet assembly. */
export function discoverEc3Pid(segment: Uint8Array): number | null {
  if (!segment.length || segment.length % 188 || segment.length > 8 * 1024 * 1024) throw new Error('Invalid TS segment');
  function sections(pid: number): Uint8Array[] {
    const result: Uint8Array[] = [];
    for (let i = 0; i < segment.length; i += 188) {
      const p = segment.subarray(i, i + 188);
      if (p[0] !== 0x47) throw new Error('Invalid TS sync');
      if (((p[1] & 31) << 8 | p[2]) !== pid) continue;
      if ((p[1] & 128) || (p[3] & 192)) throw new Error('Invalid PSI transport');
      const control = (p[3] >> 4) & 3;
      if (!(control & 1)) continue;
      if (!(p[1] & 64)) throw new Error('Unsupported split PSI');
      const start = control & 2 ? 5 + p[4] : 4;
      if (start >= 188 || p[start] !== 0) throw new Error('Unsupported PSI pointer');
      const s = start + 1;
      if (s + 3 > 188) throw new Error('Truncated PSI');
      const end = s + 3 + ((p[s+1] & 15) << 8 | p[s+2]);
      if (end > 188) throw new Error('Split PSI section');
      const section = p.subarray(s, end);
      if (!validPsiCrc(section) || p.subarray(end).some(b => b !== 255)) throw new Error('Invalid PSI CRC or trailing data');
      result.push(section);
    }
    return result;
  }
  const programs = new Map<number, number>();
  for (const pat of sections(0)) {
    if (pat.length < 12 || pat[0] !== 0 || !(pat[1] & 128) || !(pat[5] & 1) || pat[6] || pat[7] || (pat.length - 12) % 4) throw new Error('Unsupported PAT');
    for (let i = 8; i < pat.length - 4; i += 4) {
      const program = pat[i] << 8 | pat[i+1];
      const pid = (pat[i+2] & 31) << 8 | pat[i+3];
      if (!program) continue;
      if (pid < 32 || pid >= 8191 || (programs.has(program) && programs.get(program) !== pid)) throw new Error('Ambiguous PAT');
      programs.set(program, pid);
    }
  }
  if (programs.size !== 1) return null;
  const [program, pmtPid] = [...programs][0];
  const candidates = new Set<number | null>();
  for (const pmt of sections(pmtPid)) {
    if ((pmt[3] << 8 | pmt[4]) !== program) throw new Error('PMT program mismatch');
    candidates.add(findEc3Pid(pmt));
  }
  if (candidates.size > 1) throw new Error('Changing EC-3 PID');
  return candidates.values().next().value ?? null;
}
