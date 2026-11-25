/**
 * Bounded E-AC-3 syncframe scanner for explicit raw elementary-stream bytes.
 *
 * This is a transport parsing primitive, NOT a JOC/Atmos decoder or an HLS/fMP4
 * demuxer. A syntactically valid header is only a candidate, not codec proof.
 * The caller must already possess raw EC-3 elementary-stream bytes legally.
 */
export interface Ec3FrameCandidate {
  offset: number;
  length: number;
  streamType: 0 | 1 | 2;
  substreamId: number;
  sampleRateHz: 24000 | 22050 | 16000 | 48000 | 44100 | 32000;
  blocksPerFrame: 1 | 2 | 3 | 6;
  channelMode: number;
  lfe: boolean;
}

export interface Ec3ScanResult {
  frames: Ec3FrameCandidate[];
  /** Offset from which any remaining incomplete candidate must be retained. */
  remainderOffset: number;
  /** True if scanning stopped at the caller-imposed frame count. */
  limitReached: boolean;
}

const MAX_FRAME_BYTES = 4096;
const SAMPLE_RATES = [48000, 44100, 32000] as const;
const HALF_SAMPLE_RATES = [24000, 22050, 16000] as const;
const BLOCK_COUNTS = [1, 2, 3, 6] as const;

function parseHeader(data: Uint8Array, offset: number): Ec3FrameCandidate | null {
  if (offset + 6 > data.length || data[offset] !== 0x0b || data[offset + 1] !== 0x77) return null;
  const third = data[offset + 2];
  const fourth = data[offset + 3];
  const fifth = data[offset + 4];
  const streamType = third >> 6;
  if (streamType === 3 || (data[offset + 5] >> 3) !== 16) return null; // bsid=16 is E-AC-3
  const frameLength = ((((third & 7) << 8) | fourth) + 1) * 2;
  if (frameLength < 6 || frameLength > MAX_FRAME_BYTES) return null;
  const fscod = fifth >> 6;
  const fscod2 = (fifth >> 4) & 3;
  if (fscod === 3 && fscod2 === 3) return null;
  const sampleRateHz = fscod === 3 ? HALF_SAMPLE_RATES[fscod2] : SAMPLE_RATES[fscod];
  const blocksPerFrame = fscod === 3 ? 6 : BLOCK_COUNTS[(fifth >> 4) & 3];
  return {
    offset,
    length: frameLength,
    streamType: streamType as 0 | 1 | 2,
    substreamId: (third >> 3) & 7,
    sampleRateHz,
    blocksPerFrame,
    channelMode: (fifth >> 1) & 7,
    lfe: (fifth & 1) !== 0,
  };
}

/**
 * Scans raw E-AC-3 bytes without fetching, decoding or altering playback.
 *
 * A candidate at the buffer end is retained for the next chunk; a trailing
 * 0x0b is also retained as a possible split sync word. The caller should
 * append data.subarray(remainderOffset) to the next chunk.
 */
export function scanEc3Syncframes(
  data: Uint8Array,
  maxFrames = 256,
): Ec3ScanResult {
  if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 4096) {
    throw new RangeError('maxFrames must be an integer between 1 and 4096');
  }
  const frames: Ec3FrameCandidate[] = [];
  let offset = 0;
  while (offset + 6 <= data.length) {
    if (frames.length === maxFrames) {
      return { frames, remainderOffset: offset, limitReached: true };
    }
    const candidate = parseHeader(data, offset);
    if (!candidate) {
      offset += 1;
      continue;
    }
    if (offset + candidate.length > data.length) {
      return { frames, remainderOffset: offset, limitReached: false };
    }
    frames.push(candidate);
    offset += candidate.length;
  }
  // Keep up to five header bytes, or a shorter suffix starting with sync.
  const scanFrom = Math.max(offset, data.length - 5);
  for (let index = scanFrom; index < data.length; index += 1) {
    if (data[index] !== 0x0b) continue;
    if (index + 1 === data.length || data[index + 1] === 0x77) {
      return { frames, remainderOffset: index, limitReached: false };
    }
  }
  return { frames, remainderOffset: data.length, limitReached: false };
}
