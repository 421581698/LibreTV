/**
 * Bounds-checked header scanner for raw, clear AC-3 elementary streams.
 *
 * Only accepts canonical bsid=8 AC-3. A matching header is a candidate, not
 * proof of CRC integrity, Dolby certification, successful decoding or output.
 * Reject E-AC-3 (bsid=16); it has a separate framing format.
 */
export interface Ac3FrameCandidate {
  offset: number;
  length: number;
  sampleRateHz: 48000 | 44100 | 32000;
  bitRateKbps: number;
  channelMode: number;
  blocksPerFrame: 6;
  bsid: 8;
}
export interface Ac3ScanResult {
  frames: Ac3FrameCandidate[];
  remainderOffset: number;
  limitReached: boolean;
}

const BITRATES_KBPS = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640] as const;
const WORDS_44100 = [69, 87, 104, 121, 139, 174, 208, 243, 278, 348, 417, 487, 557, 696, 835, 975, 1114, 1253, 1393] as const;
const RATES = [48000, 44100, 32000] as const;
const MAX_FRAME_BYTES = 4096;

function parseHeader(bytes: Uint8Array, offset: number): Ac3FrameCandidate | null {
  if (offset + 7 > bytes.length || bytes[offset] !== 0x0b || bytes[offset + 1] !== 0x77) return null;
  const fscod = bytes[offset + 4] >> 6;
  const frameSizeCode = bytes[offset + 4] & 0x3f;
  const bsid = bytes[offset + 5] >> 3;
  if (fscod === 3 || frameSizeCode >= 38 || bsid !== 8) return null;
  const bitRateKbps = BITRATES_KBPS[frameSizeCode >> 1];
  const frameWords = fscod === 0 ? bitRateKbps * 2
    : fscod === 1 ? WORDS_44100[frameSizeCode >> 1] + (frameSizeCode & 1)
      : bitRateKbps * 3;
  const length = frameWords * 2;
  if (length < 7 || length > MAX_FRAME_BYTES) return null;
  return {
    offset, length, sampleRateHz: RATES[fscod], bitRateKbps,
    channelMode: bytes[offset + 6] >> 5, blocksPerFrame: 6, bsid: 8,
  };
}

/** Resume by appending bytes.subarray(remainderOffset) to the next chunk. */
export function scanAc3Syncframes(bytes: Uint8Array, maxFrames = 256): Ac3ScanResult {
  if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 4096) {
    throw new RangeError('maxFrames must be an integer between 1 and 4096');
  }
  const frames: Ac3FrameCandidate[] = [];
  let offset = 0;
  while (offset + 7 <= bytes.length) {
    if (frames.length >= maxFrames) return { frames, remainderOffset: offset, limitReached: true };
    const candidate = parseHeader(bytes, offset);
    if (!candidate) { offset += 1; continue; }
    if (candidate.length > bytes.length - offset) {
      return { frames, remainderOffset: offset, limitReached: false };
    }
    frames.push(candidate);
    offset += candidate.length;
  }
  // Keep an incomplete sync header (at most 6 bytes) or split sync word.
  for (let index = Math.max(offset, bytes.length - 6); index < bytes.length; index += 1) {
    if (bytes[index] === 0x0b &&
        (index + 1 === bytes.length || bytes[index + 1] === 0x77)) {
      return { frames, remainderOffset: index, limitReached: false };
    }
  }
  return { frames, remainderOffset: bytes.length, limitReached: false };
}
