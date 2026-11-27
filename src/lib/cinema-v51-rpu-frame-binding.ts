import type { CinemaDecodedP010Sample } from './cinema-v51-frame-bridge';
import type { CinemaV51FrameJob } from './cinema-v51-runtime';
import type { CinemaP010TransformOptions } from './cinema-v51-p010';

/**
 * Backend verified Ed25519 signature, authenticated fMP4 assembled-source hash,
 * RPU NAL SHA and presentation PTS before returning this data. This client
 * adapter does not verify signatures itself. Only an independently authenticated
 * WebCodecs decoded P010 provider may supply the raw frame samples.
 */
export interface RegisteredRpuL1Evidence {
  version: 1;
  sourceMediaSha256: string;
  mappingSha256: string;
  playerRpuApplication: 'not-verified';
  frames: {
    frameOrdinal: number;
    pts: string;
    rpuSha256: string;
    minPq: number;
    avgPq: number;
    maxPq: number;
  }[];
}
export interface RegisteredRpuMapping {
  sourceMediaSha256: string;
  mappingSha256: string;
  timeBase: { numerator: number; denominator: number };
  frameCount: number;
}
const SHA = /^[a-f0-9]{64}$/;
/** Rational timestamp conversion to nearest microsecond, without unsafe floats. */
export function cinemaRpuPtsToMicroseconds(pts: string, timeBase: RegisteredRpuMapping['timeBase']): number | null {
  if (!/^(0|[1-9][0-9]{0,18})$/.test(pts) ||
      !Number.isSafeInteger(timeBase.numerator) || !Number.isSafeInteger(timeBase.denominator) ||
      timeBase.numerator <= 0 || timeBase.denominator <= 0) return null;
  const n=BigInt(pts)*BigInt(timeBase.numerator)*1_000_000n;
  const d=BigInt(timeBase.denominator);
  const us=(n+d/2n)/d;
  return us <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(us) : null;
}
export function cinemaBuildVerifiedRpuL1Job(
  sample: CinemaDecodedP010Sample,
  transform: CinemaP010TransformOptions,
  mapping: RegisteredRpuMapping,
  l1: RegisteredRpuL1Evidence,
): CinemaV51FrameJob {
  if (!SHA.test(sample.sourceSha256) || !SHA.test(mapping.sourceMediaSha256) ||
      sample.sourceSha256 !== mapping.sourceMediaSha256 ||
      mapping.sourceMediaSha256 !== l1.sourceMediaSha256 ||
      !SHA.test(mapping.mappingSha256) || mapping.mappingSha256 !== l1.mappingSha256 ||
      l1.version !== 1 || l1.playerRpuApplication !== 'not-verified' ||
      !Number.isSafeInteger(mapping.frameCount) || mapping.frameCount < 1 || mapping.frameCount > 8192 ||
      l1.frames.length !== mapping.frameCount ||
      transform.sourceTransfer !== 'pq' || transform.sourcePrimaries !== 'rec2020') {
    throw new Error('Unverified RPU L1 signed source mapping');
  }
  if (!Number.isSafeInteger(sample.frameIndex) || sample.frameIndex < 0 ||
      sample.frameIndex >= l1.frames.length) throw new Error('RPU frame ordinal missing');
  const metadata=l1.frames[sample.frameIndex];
  if (!metadata || metadata.frameOrdinal !== sample.frameIndex ||
      !SHA.test(metadata.rpuSha256) ||
      cinemaRpuPtsToMicroseconds(metadata.pts,mapping.timeBase) !== sample.ptsUs)
    throw new Error('RPU RPU/PTS evidence detached from decoded frame');
  return {
    decodedP010:sample.decodedP010,
    transform,
    rpuL1:{
      sourceSha256:sample.sourceSha256,
      expectedSourceSha256:mapping.sourceMediaSha256,
      rpuSha256:metadata.rpuSha256,
      expectedRpuSha256:metadata.rpuSha256,
      frameIndex:sample.frameIndex,framePtsUs:sample.ptsUs,
      minPq:metadata.minPq,avgPq:metadata.avgPq,maxPq:metadata.maxPq,
    },
  };
}
