/**
 * ISO BMFF fragmented-media metadata parser.
 *
 * This extracts per-sample timing/size/flags from moof/traf/tfhd/tfdt/trun.
 * It does not demux codecs or copy sample payloads; callers retain ownership of
 * the original ArrayBuffer and use dataOffset/size to address mdat bytes.
 */

export interface Fmp4Sample {
  readonly index: number;
  readonly decodeTime: number;
  readonly duration: number | null;
  readonly compositionTimeOffset: number;
  readonly presentationTime: number;
  readonly size: number | null;
  readonly flags: number | null;
  readonly dataOffset: number | null;
  readonly isSync: boolean | null;
}

export interface Fmp4TrackFragment {
  readonly trackId: number;
  readonly baseDecodeTime: number;
  readonly samples: readonly Fmp4Sample[];
}

export interface Fmp4Fragment {
  readonly moofOffset: number;
  readonly moofSize: number;
  readonly mdatRanges: readonly { readonly start: number; readonly end: number }[];
  readonly tracks: readonly Fmp4TrackFragment[];
}

export interface ParseFmp4Options {
  /** Optional track filter. */
  readonly trackId?: number;
  /** Maximum accepted sample count; protects against hostile metadata. */
  readonly maxSamples?: number;
}

interface Box {
  type: string;
  start: number;
  payload: number;
  end: number;
  size: number;
}

interface Tfhd {
  trackId: number;
  baseDataOffset: number | null;
  defaultDuration: number | null;
  defaultSize: number | null;
  defaultFlags: number | null;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function i32(view: DataView, offset: number): number {
  return view.getInt32(offset, false);
}

function u64(view: DataView, offset: number): number {
  const high = view.getUint32(offset, false);
  const low = view.getUint32(offset + 4, false);
  const value = high * 0x1_0000_0000 + low;
  if (!Number.isSafeInteger(value) || value > MAX_SAFE) {
    throw new Error('fMP4 64-bit value exceeds JavaScript safe integer range.');
  }
  return value;
}

function boxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readBoxes(bytes: Uint8Array, view: DataView, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) throw new Error('Truncated ISO BMFF box header.');
    const size32 = u32(view, offset);
    const type = boxType(bytes, offset + 4);
    let headerSize = 8;
    let size: number;
    if (size32 === 1) {
      if (offset + 16 > end) throw new Error('Truncated extended ISO BMFF box header.');
      size = u64(view, offset + 8);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    } else {
      size = size32;
    }
    if (size < headerSize || !Number.isSafeInteger(size) || offset + size > end) {
      throw new Error(`Invalid ISO BMFF box size for ${type}.`);
    }
    boxes.push({ type, start: offset, payload: offset + headerSize, end: offset + size, size });
    offset += size;
  }
  return boxes;
}

function parseTfhd(view: DataView, box: Box): Tfhd {
  if (box.payload + 8 > box.end) throw new Error('Truncated tfhd box.');
  const versionAndFlags = u32(view, box.payload);
  const flags = versionAndFlags & 0x00ff_ffff;
  let offset = box.payload + 4;
  const trackId = u32(view, offset);
  offset += 4;
  let baseDataOffset: number | null = null;
  let defaultDuration: number | null = null;
  let defaultSize: number | null = null;
  let defaultFlags: number | null = null;
  if (flags & 0x000001) { baseDataOffset = u64(view, offset); offset += 8; }
  if (flags & 0x000002) offset += 4; // sample_description_index
  if (flags & 0x000008) { defaultDuration = u32(view, offset); offset += 4; }
  if (flags & 0x000010) { defaultSize = u32(view, offset); offset += 4; }
  if (flags & 0x000020) { defaultFlags = u32(view, offset); offset += 4; }
  if (offset > box.end) throw new Error('tfhd fields exceed box bounds.');
  return { trackId, baseDataOffset, defaultDuration, defaultSize, defaultFlags };
}

function parseTfdt(view: DataView, box: Box): number {
  if (box.payload + 8 > box.end) throw new Error('Truncated tfdt box.');
  const version = view.getUint8(box.payload);
  if (version === 0) return u32(view, box.payload + 4);
  if (version === 1) {
    if (box.payload + 12 > box.end) throw new Error('Truncated version 1 tfdt box.');
    return u64(view, box.payload + 4);
  }
  throw new Error(`Unsupported tfdt version ${version}.`);
}

function parseTrun(
  view: DataView,
  box: Box,
  tfhd: Tfhd,
  baseDecodeTime: number,
  baseDataOffset: number,
  initialDataOffset: number | null,
  maxSamples: number,
): { samples: Fmp4Sample[]; nextDataOffset: number | null } {
  if (box.payload + 8 > box.end) throw new Error('Truncated trun box.');
  const version = view.getUint8(box.payload);
  const flags = view.getUint32(box.payload, false) & 0x00ff_ffff;
  const sampleCount = u32(view, box.payload + 4);
  if (sampleCount > maxSamples) throw new Error('fMP4 sample count exceeds configured limit.');
  let offset = box.payload + 8;
  let dataOffset = initialDataOffset;
  let firstSampleFlags: number | null = null;
  if (flags & 0x000001) {
    if (offset + 4 > box.end) throw new Error('Truncated trun data_offset.');
    dataOffset = baseDataOffset + i32(view, offset);
    offset += 4;
  }
  if (flags & 0x000004) {
    if (offset + 4 > box.end) throw new Error('Truncated trun first_sample_flags.');
    firstSampleFlags = u32(view, offset);
    offset += 4;
  }

  const samples: Fmp4Sample[] = [];
  let decodeTime = baseDecodeTime;
  for (let index = 0; index < sampleCount; index += 1) {
    let duration = tfhd.defaultDuration;
    let size = tfhd.defaultSize;
    let sampleFlags = index === 0 && firstSampleFlags !== null ? firstSampleFlags : tfhd.defaultFlags;
    let compositionTimeOffset = 0;
    if (flags & 0x000100) { if (offset + 4 > box.end) throw new Error('Truncated trun sample duration.'); duration = u32(view, offset); offset += 4; }
    if (flags & 0x000200) { if (offset + 4 > box.end) throw new Error('Truncated trun sample size.'); size = u32(view, offset); offset += 4; }
    if (flags & 0x000400) { if (offset + 4 > box.end) throw new Error('Truncated trun sample flags.'); sampleFlags = u32(view, offset); offset += 4; }
    if (flags & 0x000800) {
      if (offset + 4 > box.end) throw new Error('Truncated trun composition time offset.');
      compositionTimeOffset = version === 1 ? i32(view, offset) : u32(view, offset);
      offset += 4;
    }
    const sample: Fmp4Sample = {
      index,
      decodeTime,
      duration,
      compositionTimeOffset,
      presentationTime: decodeTime + compositionTimeOffset,
      size,
      flags: sampleFlags,
      dataOffset,
      isSync: sampleFlags === null ? null : (sampleFlags & 0x0001_0000) === 0,
    };
    samples.push(sample);
    if (duration !== null) decodeTime += duration;
    if (dataOffset !== null && size !== null) dataOffset += size;
    else dataOffset = null;
  }
  if (offset > box.end) throw new Error('trun fields exceed box bounds.');
  return { samples, nextDataOffset: dataOffset };
}

/**
 * Parse one or more movie fragments from an fMP4 byte range.
 * Times are returned in each track's native media timescale (from mdhd).
 */
export function parseFmp4Fragments(input: ArrayBuffer | Uint8Array, options: ParseFmp4Options = {}): Fmp4Fragment[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maxSamples = options.maxSamples ?? 100_000;
  if (!Number.isInteger(maxSamples) || maxSamples < 1) throw new Error('maxSamples must be a positive integer.');
  const topLevel = readBoxes(bytes, view, 0, bytes.length);
  const mdats = topLevel.filter(box => box.type === 'mdat').map(box => ({ start: box.payload, end: box.end }));
  const fragments: Fmp4Fragment[] = [];

  for (const moof of topLevel.filter(box => box.type === 'moof')) {
    const children = readBoxes(bytes, view, moof.payload, moof.end);
    const tracks: Fmp4TrackFragment[] = [];
    for (const traf of children.filter(box => box.type === 'traf')) {
      const fields = readBoxes(bytes, view, traf.payload, traf.end);
      const tfhdBox = fields.find(box => box.type === 'tfhd');
      const tfdtBox = fields.find(box => box.type === 'tfdt');
      if (!tfhdBox || !tfdtBox) throw new Error('Each parsed traf must contain tfhd and tfdt boxes.');
      const tfhd = parseTfhd(view, tfhdBox);
      if (options.trackId !== undefined && tfhd.trackId !== options.trackId) continue;
      const baseDecodeTime = parseTfdt(view, tfdtBox);
      const baseDataOffset = tfhd.baseDataOffset ?? moof.start;
      let nextDataOffset: number | null = null;
      let decodeTime = baseDecodeTime;
      const samples: Fmp4Sample[] = [];
      for (const trun of fields.filter(box => box.type === 'trun')) {
        const parsed = parseTrun(view, trun, tfhd, decodeTime, baseDataOffset, nextDataOffset, maxSamples - samples.length);
        samples.push(...parsed.samples.map((sample, index) => ({ ...sample, index: samples.length + index })));
        nextDataOffset = parsed.nextDataOffset;
        const last = parsed.samples[parsed.samples.length - 1];
        if (last?.duration !== null && last) decodeTime = last.decodeTime + last.duration;
      }
      tracks.push({ trackId: tfhd.trackId, baseDecodeTime, samples });
    }
    fragments.push({ moofOffset: moof.start, moofSize: moof.size, mdatRanges: mdats, tracks });
  }
  return fragments;
}

/**
 * Return a zero-copy view of one parsed sample payload.
 * Offsets are relative to the exact byte range passed to parseFmp4Fragments.
 */
export function extractFmp4SamplePayload(
  input: ArrayBuffer | Uint8Array,
  sample: Pick<Fmp4Sample, 'dataOffset' | 'size'>,
): Uint8Array {
  if (sample.dataOffset === null || sample.size === null) {
    throw new Error('Sample payload offset and size are not available in fragment metadata.');
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const end = sample.dataOffset + sample.size;
  if (!Number.isSafeInteger(sample.dataOffset) || !Number.isSafeInteger(end) ||
      sample.dataOffset < 0 || sample.size < 0 || end > bytes.length) {
    throw new Error('Sample payload range is outside the supplied fMP4 byte range.');
  }
  return bytes.subarray(sample.dataOffset, end);
}
