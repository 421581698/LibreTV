import { createHash } from 'node:crypto';

export interface RpuFrameBinding {
  frameOrdinal: number;
  pts: string;
  rpuSha256: string;
}

/** Canonical digest for independently established frame mappings.
 * This validates the mapping structure, not the accuracy of extraction.
 * Callers must establish the frame/RPU relationship before signing.
 */
export function digestRpuFrameMapping(
  mediaSha256: string,
  timeBase: { numerator: number; denominator: number },
  frames: readonly RpuFrameBinding[],
): string {
  const sha = /^[a-f0-9]{64}$/;
  if (!sha.test(mediaSha256) || !Number.isSafeInteger(timeBase.numerator) ||
      !Number.isSafeInteger(timeBase.denominator) || timeBase.numerator <= 0 ||
      timeBase.denominator <= 0 || !frames.length || frames.length > 8192) {
    throw new Error('Invalid frame mapping context');
  }
  const hash = createHash('sha256').update(`libretv-rpu-frame-mapping-v1\n${mediaSha256}\n${timeBase.numerator}/${timeBase.denominator}\n`);
  let previous: bigint | null = null;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.frameOrdinal !== i || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(frame.pts) ||
        !sha.test(frame.rpuSha256)) throw new Error('Invalid frame mapping entry');
    const pts = BigInt(frame.pts);
    if (pts < -(1n << 63n) || pts >= (1n << 63n) ||
        (previous !== null && pts <= previous)) throw new Error('Ambiguous presentation order');
    previous = pts;
    hash.update(`${i}:${frame.pts}:${frame.rpuSha256}\n`);
  }
  return hash.digest('hex');
}
