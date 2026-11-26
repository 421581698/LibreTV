import { createHash } from 'node:crypto';

// A deliberately bounded single-layer MP4 sample parser. The caller must
// independently verify sample boundaries, hvcC length size and decoded PTS.
export function extractHevcSampleRpu(sample, lengthSize) {
  if (!Buffer.isBuffer(sample) || !sample.length || sample.length > 32 * 1024 * 1024 ||
      ![1, 2, 4].includes(lengthSize)) throw new Error('Invalid HEVC sample');
  let offset = 0;
  let pictures = 0;
  let rpu = null;
  let count = 0;
  while (offset < sample.length) {
    if (++count > 65536 || offset + lengthSize > sample.length) throw new Error('Invalid NAL boundary');
    const size = sample.readUIntBE(offset, lengthSize);
    offset += lengthSize;
    if (size < 3 || size > sample.length - offset) throw new Error('Invalid NAL size');
    const nal = sample.subarray(offset, offset + size);
    offset += size;
    const type = (nal[0] >> 1) & 63;
    const layer = ((nal[0] & 1) << 5) | (nal[1] >> 3);
    if ((nal[0] & 128) || layer !== 0 || !(nal[1] & 7)) throw new Error('Unsupported HEVC NAL header');
    if (type <= 31) {
      if (nal[2] & 128) pictures++;
      else if (!pictures) throw new Error('Missing first slice');
    }
    if (type === 62) {
      if (rpu || nal[0] !== 0x7c || nal[1] !== 1 || nal[2] !== 0x19 || nal.length < 9) throw new Error('Ambiguous RPU');
      rpu = nal.subarray(2);
    }
  }
  if (pictures !== 1 || !rpu) throw new Error('Expected exactly one picture and one RPU');
  return { rpuSha256: createHash('sha256').update(rpu).digest('hex'), rpu };
}

/** Bind independently probed decoded timestamps to exact MP4 sample bytes.
 * Packet order may differ from presentation order; no positional guessing.
 */
export function bindHevcDecodedFrames(samples, decodedPts, lengthSize) {
  if (!Array.isArray(samples) || !Array.isArray(decodedPts) ||
      !samples.length || samples.length > 8192 || samples.length !== decodedPts.length) {
    throw new Error('Incomplete HEVC frame evidence');
  }
  const canonicalPts = value => {
    if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(value)) throw new Error('Invalid PTS');
    const pts = BigInt(value);
    if (pts < -(1n << 63n) || pts >= (1n << 63n)) throw new Error('PTS out of range');
    return pts;
  };
  const byPts = new Map();
  for (const sample of samples) {
    canonicalPts(sample.pts);
    if (byPts.has(sample.pts)) throw new Error('Duplicate sample PTS');
    byPts.set(sample.pts, extractHevcSampleRpu(sample.bytes, lengthSize).rpuSha256);
  }
  let previous = null;
  return decodedPts.map((pts, frameOrdinal) => {
    const value = canonicalPts(pts);
    if (!byPts.has(pts) || (previous !== null && value <= previous)) throw new Error('Unmatched or unordered decoded frame');
    previous = value;
    const rpuSha256 = byPts.get(pts);
    byPts.delete(pts);
    return { frameOrdinal, pts, rpuSha256 };
  });
}
