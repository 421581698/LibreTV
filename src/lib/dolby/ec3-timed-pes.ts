import { scanEc3Syncframes } from './ec3-syncframe-scanner';
import type { Ec3Pes } from './ec3-ts-pes';

export interface TimedEc3Frame { bytes: Uint8Array; ptsSamples: bigint; sampleRate: number }

/** Strict experimental subset: complete independent EC-3 frames in a timestamped PES.
 * Reject dependent substreams, partial frames and ambiguous clocks rather than
 * inventing timestamps. The caller must establish the media timeline origin.
 */
export function timedEc3PesFrames(pes: Ec3Pes, origin90k: number): TimedEc3Frame[] {
  if (pes.pts90k === null || !Number.isSafeInteger(pes.pts90k) ||
      !Number.isSafeInteger(origin90k) || origin90k < 0 ||
      pes.pts90k < origin90k || pes.pts90k >= 2 ** 33 ||
      pes.bytes.length === 0 || pes.bytes.length > 256 * 1024) {
    throw new Error('Unsupported EC-3 PES timeline');
  }
  const scan = scanEc3Syncframes(pes.bytes);
  if (scan.limitReached || !scan.frames.length) throw new Error('Unsupported EC-3 frame count');
  const rate = scan.frames[0].sampleRateHz;
  const scaled = BigInt(pes.pts90k - origin90k) * BigInt(rate);
  if (scaled % 90000n !== 0n) throw new Error('Nonintegral EC-3 sample timestamp');
  let pts = scaled / 90000n;
  let offset = 0;
  const result: TimedEc3Frame[] = [];
  for (const frame of scan.frames) {
    if (frame.offset !== offset || frame.streamType !== 0 ||
        frame.substreamId !== 0 || frame.sampleRateHz !== rate) {
      throw new Error('Unsupported EC-3 frame sequence');
    }
    result.push({ bytes: pes.bytes.slice(offset, offset + frame.length), ptsSamples: pts, sampleRate: rate });
    offset += frame.length;
    pts += BigInt(frame.blocksPerFrame * 256);
  }
  if (offset !== pes.bytes.length) throw new Error('Incomplete EC-3 PES frames');
  return result;
}
