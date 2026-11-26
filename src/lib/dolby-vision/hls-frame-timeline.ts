import type { RpuFrameBinding } from './frame-mapping-evidence';

interface FragmentMapping {
  timeBase: { numerator: number; denominator: number };
  frames: readonly RpuFrameBinding[];
}

/** Compare exact rational presentation times without rounding.
 * Strictly ordered fragments only; this does not prove gap-free variable
 * frame rate playback, which requires independent sample durations.
 */
export function verifyHlsFramePresentationOrder(fragments: readonly FragmentMapping[]): boolean {
  if (!fragments.length || fragments.length > 10000) return false;
  let previous: { numerator: bigint; denominator: bigint } | null = null;
  for (const fragment of fragments) {
    const { numerator, denominator } = fragment.timeBase;
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) ||
        numerator <= 0 || denominator <= 0 || !fragment.frames.length ||
        fragment.frames.length > 8192) return false;
    for (let i = 0; i < fragment.frames.length; i++) {
      const frame = fragment.frames[i];
      if (frame.frameOrdinal !== i || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(frame.pts)) return false;
      const pts = BigInt(frame.pts);
      if (pts < -(1n << 63n) || pts >= (1n << 63n)) return false;
      const current = { numerator: pts * BigInt(numerator), denominator: BigInt(denominator) };
      if (previous && current.numerator * previous.denominator <= previous.numerator * current.denominator) return false;
      previous = current;
    }
  }
  return true;
}

/** Prove a fixed presentation cadence against independently registered
 * fragment sample counts and total decode durations. Variable cadence,
 * edit-list offsets and cross-fragment reordering remain unestablished.
 */
export function verifyHlsFixedCadence(
  fragments: readonly FragmentMapping[],
  registered: readonly { sampleCount: number; sampleDuration: number; timescale: number }[],
): boolean {
  if (fragments.length !== registered.length || !verifyHlsFramePresentationOrder(fragments)) return false;
  const first = registered[0];
  const valid = (n: number) => Number.isSafeInteger(n) && n > 0;
  if (![first.sampleCount, first.sampleDuration, first.timescale].every(valid)) return false;
  const stepN = BigInt(first.sampleDuration);
  const stepD = BigInt(first.timescale) * BigInt(first.sampleCount);
  let previous: { n: bigint; d: bigint } | null = null;
  for (let i = 0; i < fragments.length; i++) {
    const r = registered[i];
    const f = fragments[i];
    if (![r.sampleCount,r.sampleDuration,r.timescale].every(valid) || r.sampleCount !== f.frames.length ||
        BigInt(r.sampleDuration)*stepD !== stepN*BigInt(r.timescale)*BigInt(r.sampleCount)) return false;
    for (const frame of f.frames) {
      const current = {n:BigInt(frame.pts)*BigInt(f.timeBase.numerator),d:BigInt(f.timeBase.denominator)};
      if (previous && (current.n*previous.d-previous.n*current.d)*stepD !== stepN*current.d*previous.d) return false;
      previous = current;
    }
  }
  return true;
}
