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
  /** Initialization metadata supplies movie-level trex defaults when tfhd omits them. */
  readonly initSegment?: Fmp4InitSegment;
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
  defaultBaseIsMoof: boolean;
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
  return { trackId, baseDataOffset, defaultDuration, defaultSize, defaultFlags, defaultBaseIsMoof: Boolean(flags & 0x020000) };
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
  baseDataOffset: number | null,
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
    dataOffset = baseDataOffset === null ? null : baseDataOffset + i32(view, offset);
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


export interface Fmp4TrackMetadata {
  readonly trackId: number;
  readonly timescale: number;
  readonly handlerType: string;
  readonly sampleEntry: string | null;
  readonly defaultSampleDescriptionIndex: number | null;
  readonly defaultSampleDuration: number | null;
  readonly defaultSampleSize: number | null;
  readonly defaultSampleFlags: number | null;
}

export interface Fmp4InitSegment {
  readonly tracks: readonly Fmp4TrackMetadata[];
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  if (start < 0 || length < 0 || start + length > bytes.length) {
    throw new Error('ISO BMFF text field exceeds box bounds.');
  }
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function parseTrackId(view: DataView, box: Box): number {
  if (box.payload + 16 > box.end) throw new Error('Truncated tkhd box.');
  const version = view.getUint8(box.payload);
  const offset = box.payload + (version === 1 ? 20 : 12);
  if (offset + 4 > box.end) throw new Error('Truncated tkhd track id.');
  if (version !== 0 && version !== 1) throw new Error(`Unsupported tkhd version ${version}.`);
  return u32(view, offset);
}

function parseTimescale(view: DataView, box: Box): number {
  if (box.payload + 16 > box.end) throw new Error('Truncated mdhd box.');
  const version = view.getUint8(box.payload);
  const offset = box.payload + (version === 1 ? 20 : 12);
  if (version !== 0 && version !== 1) throw new Error(`Unsupported mdhd version ${version}.`);
  if (offset + 4 > box.end) throw new Error('Truncated mdhd timescale.');
  const timescale = u32(view, offset);
  if (timescale === 0) throw new Error('Track timescale must be greater than zero.');
  return timescale;
}

function parseHandlerType(bytes: Uint8Array, view: DataView, box: Box): string {
  if (box.payload + 12 > box.end) throw new Error('Truncated hdlr box.');
  return readAscii(bytes, box.payload + 8, 4);
}

function parseTrex(view: DataView, box: Box): {
  trackId: number;
  descriptionIndex: number;
  duration: number;
  size: number;
  flags: number;
} {
  if (box.payload + 24 > box.end) throw new Error('Truncated trex box.');
  return {
    trackId: u32(view, box.payload + 4),
    descriptionIndex: u32(view, box.payload + 8),
    duration: u32(view, box.payload + 12),
    size: u32(view, box.payload + 16),
    flags: u32(view, box.payload + 20),
  };
}

/**
 * Parse the initialization segment's movie/track metadata.
 * This supplies each track's media timescale and movie-level trex defaults;
 * it does not decode codec configuration records or instantiate a decoder.
 */
export function parseFmp4InitSegment(input: ArrayBuffer | Uint8Array): Fmp4InitSegment {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const topLevel = readBoxes(bytes, view, 0, bytes.length);
  const moov = topLevel.find(box => box.type === 'moov');
  if (!moov) throw new Error('fMP4 initialization segment is missing moov.');
  const movieChildren = readBoxes(bytes, view, moov.payload, moov.end);
  const mvex = movieChildren.find(box => box.type === 'mvex');
  const trexDefaults = new Map<number, ReturnType<typeof parseTrex>>();
  if (mvex) {
    for (const trexBox of readBoxes(bytes, view, mvex.payload, mvex.end).filter(box => box.type === 'trex')) {
      const trex = parseTrex(view, trexBox);
      if (trexDefaults.has(trex.trackId)) throw new Error(`Duplicate trex defaults for track ${trex.trackId}.`);
      trexDefaults.set(trex.trackId, trex);
    }
  }

  const tracks: Fmp4TrackMetadata[] = [];
  const seenTrackIds = new Set<number>();
  for (const trak of movieChildren.filter(box => box.type === 'trak')) {
    const trakChildren = readBoxes(bytes, view, trak.payload, trak.end);
    const tkhd = trakChildren.find(box => box.type === 'tkhd');
    const mdia = trakChildren.find(box => box.type === 'mdia');
    if (!tkhd || !mdia) throw new Error('Each fMP4 trak must contain tkhd and mdia.');
    const trackId = parseTrackId(view, tkhd);
    if (trackId <= 0 || seenTrackIds.has(trackId)) throw new Error('fMP4 track IDs must be unique positive integers.');
    seenTrackIds.add(trackId);

    const mediaChildren = readBoxes(bytes, view, mdia.payload, mdia.end);
    const mdhd = mediaChildren.find(box => box.type === 'mdhd');
    const hdlr = mediaChildren.find(box => box.type === 'hdlr');
    const minf = mediaChildren.find(box => box.type === 'minf');
    if (!mdhd || !hdlr || !minf) throw new Error(`Track ${trackId} is missing mdhd, hdlr or minf.`);
    const minfChildren = readBoxes(bytes, view, minf.payload, minf.end);
    const stbl = minfChildren.find(box => box.type === 'stbl');
    const stblChildren = stbl ? readBoxes(bytes, view, stbl.payload, stbl.end) : [];
    const stsd = stblChildren.find(box => box.type === 'stsd');
    let sampleEntry: string | null = null;
    if (stsd) {
      if (stsd.payload + 8 > stsd.end) throw new Error('Truncated stsd box.');
      const entryCount = u32(view, stsd.payload + 4);
      const entries = readBoxes(bytes, view, stsd.payload + 8, stsd.end);
      if (entries.length !== entryCount) throw new Error('stsd entry count does not match its box contents.');
      sampleEntry = entries[0]?.type ?? null;
    }
    const defaults = trexDefaults.get(trackId);
    tracks.push({
      trackId,
      timescale: parseTimescale(view, mdhd),
      handlerType: parseHandlerType(bytes, view, hdlr),
      sampleEntry,
      defaultSampleDescriptionIndex: defaults?.descriptionIndex ?? null,
      defaultSampleDuration: defaults?.duration ?? null,
      defaultSampleSize: defaults?.size ?? null,
      defaultSampleFlags: defaults?.flags ?? null,
    });
  }
  if (tracks.length === 0) throw new Error('fMP4 initialization segment contains no tracks.');
  return { tracks };
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
    let implicitBaseDataOffset: number | null = null;
    const trafs = children.filter(box => box.type === 'traf');
    for (let trafIndex = 0; trafIndex < trafs.length; trafIndex += 1) {
      const traf = trafs[trafIndex];
      const fields = readBoxes(bytes, view, traf.payload, traf.end);
      const tfhdBox = fields.find(box => box.type === 'tfhd');
      const tfdtBox = fields.find(box => box.type === 'tfdt');
      if (!tfhdBox || !tfdtBox) throw new Error('Each parsed traf must contain tfhd and tfdt boxes.');
      const parsedTfhd = parseTfhd(view, tfhdBox);
      const trex = options.initSegment?.tracks.find(track => track.trackId === parsedTfhd.trackId);
      const tfhd: Tfhd = {
        ...parsedTfhd,
        defaultDuration: parsedTfhd.defaultDuration ?? trex?.defaultSampleDuration ?? null,
        defaultSize: parsedTfhd.defaultSize ?? trex?.defaultSampleSize ?? null,
        defaultFlags: parsedTfhd.defaultFlags ?? trex?.defaultSampleFlags ?? null,
      };
      const baseDecodeTime = parseTfdt(view, tfdtBox);
      const baseDataOffset = tfhd.baseDataOffset ??
        (tfhd.defaultBaseIsMoof || trafIndex === 0 ? moof.start : implicitBaseDataOffset);
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
      // The next traf's implicit base is the end of this traf's resolved sample data.
      implicitBaseDataOffset = nextDataOffset;
      if (options.trackId === undefined || parsedTfhd.trackId === options.trackId) {
        tracks.push({ trackId: tfhd.trackId, baseDecodeTime, samples });
      }
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
