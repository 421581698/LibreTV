/** Strict PMT section inspection. Caller supplies a complete, verified PMT
 * section from the selected PAT program. No encrypted stream support.
 */
export function findEc3Pid(section: Uint8Array): number | null {
  if (section.length < 16 || section[0] !== 2 || !(section[1] & 128)) throw new Error('Invalid PMT');
  const length = ((section[1] & 15) << 8) | section[2];
  if (length > 1021 || length + 3 !== section.length || !(section[5] & 1) ||
      section[6] !== 0 || section[7] !== 0) throw new Error('Unsupported PMT section');
  const end = section.length - 4;
  let offset = 12 + (((section[10] & 15) << 8) | section[11]);
  if (offset > end) throw new Error('Invalid PMT program descriptors');
  const candidates = new Set<number>();
  while (offset < end) {
    if (offset + 5 > end) throw new Error('Truncated PMT stream');
    const type = section[offset];
    const pid = ((section[offset + 1] & 31) << 8) | section[offset + 2];
    const next = offset + 5 + (((section[offset + 3] & 15) << 8) | section[offset + 4]);
    if (next > end) throw new Error('Truncated PMT descriptors');
    let ec3 = type === 0x87;
    for (let d = offset + 5; d < next;) {
      if (d + 2 > next || d + 2 + section[d + 1] > next) throw new Error('Invalid PMT descriptor');
      if (type === 6 && section[d] === 0x7a) ec3 = true;
      d += 2 + section[d + 1];
    }
    if (ec3) {
      if (pid < 32 || pid >= 8191) throw new Error('Invalid EC-3 PID');
      candidates.add(pid);
    }
    offset = next;
  }
  if (candidates.size > 1) throw new Error('Ambiguous EC-3 tracks');
  return candidates.values().next().value ?? null;
}
