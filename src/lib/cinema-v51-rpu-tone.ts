import {
  cinemaClamp, cinemaConvertGamut, cinemaDecodeLuminance, cinemaEncodeLuminance,
  cinemaPqEotf, cinemaToneMapNits, type CinemaPixelOptions, type CinemaRgb,
} from './cinema-v51-color';

/**
 * Caller must obtain these values from the server-verified Ed25519 report
 * and bind them to the exact authenticated decoder sample source+PTS.
 * RPU L1 is a brightness statistic, NOT the full Dolby display-management
 * transform, and cannot reconstruct enhancement layers or Profile 5 IPT.
 */
export interface CinemaRpuL1Frame {
  sourceSha256: string;
  expectedSourceSha256: string;
  frameIndex: number;
  framePtsUs: number;
  rpuSha256: string;
  expectedRpuSha256: string;
  minPq: number;
  avgPq: number;
  maxPq: number;
}
export function cinemaValidateRpuL1Frame(frame: CinemaRpuL1Frame): void {
  if (!/^[a-f0-9]{64}$/.test(frame.sourceSha256) ||
      frame.sourceSha256 !== frame.expectedSourceSha256 ||
      !/^[a-f0-9]{64}$/.test(frame.rpuSha256) ||
      frame.rpuSha256 !== frame.expectedRpuSha256 ||
      !Number.isSafeInteger(frame.frameIndex) || frame.frameIndex < 0 ||
      !Number.isSafeInteger(frame.framePtsUs) || frame.framePtsUs < 0 ||
      ![frame.minPq,frame.avgPq,frame.maxPq].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=4095) ||
      frame.minPq > frame.avgPq || frame.avgPq > frame.maxPq || frame.maxPq === 0)
    throw new Error('Unverified RPU L1 source, frame timestamp, or luminance');
}
/** LibreTV L1-driven dynamic tone mapping for a *real decoded* PQ/Rec2020 P010 frame.
 * Not the proprietary/official Dolby Vision rendering algorithm.
 */
export function cinemaTransformRpuL1Pixel(rgb: CinemaRgb, options: CinemaPixelOptions, l1: CinemaRpuL1Frame): [number,number,number] {
  cinemaValidateRpuL1Frame(l1);
  if (options.sourceTransfer !== 'pq' || options.sourcePrimaries !== 'rec2020')
    throw new Error('RPU mapping requires verified Rec.2020 PQ decoded input');
  const sourcePeak = cinemaPqEotf(l1.maxPq/4095);
  const average = cinemaPqEotf(l1.avgPq/4095);
  if (sourcePeak < .01 || !Number.isFinite(average) ||
      !Number.isFinite(options.targetPeakNits) || options.targetPeakNits <= 0)
    throw new Error('Invalid RPU dynamic luminance');
  const knee = cinemaClamp(.5 + .2*average/Math.max(1,sourcePeak),.5,.7);
  const decoded = rgb.map(c=>cinemaDecodeLuminance(c,'pq')) as [number,number,number];
  const max = Math.max(0,...decoded);
  const peak = cinemaToneMapNits(max,Math.max(1,sourcePeak),options.targetPeakNits,knee);
  const scale = max > 0 ? peak/max : 0;
  const gamut = cinemaConvertGamut(
    [decoded[0]*scale,decoded[1]*scale,decoded[2]*scale],
    'rec2020',options.targetPrimaries);
  return gamut.map(v=>cinemaEncodeLuminance(Math.max(0,v),options.targetTransfer,
    options.targetWhiteNits,options.targetPeakNits)) as [number,number,number];
}
