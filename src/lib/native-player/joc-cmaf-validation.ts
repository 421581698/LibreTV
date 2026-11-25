import {
  validateD0ChannelMapAgainstDec3,
  type Ec3SpecificConfig,
} from './joc-dec3-config';

/**
 * Structural admission checks for one ETSI E-AC-3 CMAF sample.
 * A sample contains exactly one 1536-sample AU: I0, optionally followed by D0.
 * This parses the BSI fields needed to bind the sample to dec3; it is not a
 * replacement for the full upstream E-AC-3/JOC syntax validator.
 */
export interface CmafEac3AccessUnitShape {
  readonly syncframes: number;
  readonly hasDependentD0: boolean;
  readonly independentBsid: number;
}

interface SyncframeHeader {
  readonly streamType: number;
  readonly substreamId: number;
  readonly frameBytes: number;
  readonly sampleRateCode: number;
  readonly blocksCode: number;
  readonly bsid: number;
  readonly acmod: number;
  readonly lfeOn: boolean;
}

class BitCursor {
  private position = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(width: number): number {
    if (!Number.isInteger(width) || width < 0 || width > 24 ||
        this.position + width > this.bytes.byteLength * 8) {
      throw new Error('E-AC-3 CMAF sample contains truncated BSI fields.');
    }
    let value = 0;
    for (let index = 0; index < width; index += 1) {
      const byte = this.bytes[this.position >> 3];
      value = (value << 1) | ((byte >> (7 - (this.position & 7))) & 1);
      this.position += 1;
    }
    return value;
  }
  skip(width: number): void {
    if (!Number.isInteger(width) || width < 0 || this.position + width > this.bytes.byteLength * 8) {
      throw new Error('E-AC-3 CMAF sample contains truncated BSI fields.');
    }
    this.position += width;
  }
}

function parseHeader(bytes: Uint8Array, offset: number): SyncframeHeader {
  if (offset + 6 > bytes.length) throw new Error('E-AC-3 CMAF sample contains a truncated syncframe header.');
  if (bytes[offset] !== 0x0b || bytes[offset + 1] !== 0x77) {
    throw new Error('E-AC-3 CMAF sample contains an invalid syncword.');
  }
  const streamType = bytes[offset + 2] >> 6;
  const substreamId = (bytes[offset + 2] >> 3) & 0x07;
  const frameWords = (((bytes[offset + 2] & 0x07) << 8) | bytes[offset + 3]) + 1;
  const frameBytes = frameWords * 2;
  const sampleRateCode = bytes[offset + 4] >> 6;
  const blocksCode = (bytes[offset + 4] >> 4) & 0x03;
  const acmod = (bytes[offset + 4] >> 1) & 0x07;
  const lfeOn = (bytes[offset + 4] & 1) !== 0;
  const bsid = (bytes[offset + 5] >> 3) & 0x1f;
  if (frameBytes < 6 || offset + frameBytes > bytes.length) {
    throw new Error('E-AC-3 CMAF sample contains a truncated syncframe that exceeds the sample boundary.');
  }
  return { streamType, substreamId, frameBytes, sampleRateCode, blocksCode, bsid, acmod, lfeOn };
}

/** Read E.1.2.2 dependent-substream BSI through chanmape/chanmap. */
function parseD0ChannelMap(frame: Uint8Array): number {
  const bits = new BitCursor(frame);
  bits.skip(36); // syncword, stream type, substream id, frame size, fscod, numblkscod
  const acmod = bits.read(3);
  bits.skip(1); // lfeon
  bits.skip(5); // bsid
  bits.skip(5); // dialnorm
  if (bits.read(1) !== 0) bits.skip(8); // compre
  if (acmod === 0) {
    bits.skip(5); // dialnorm2
    if (bits.read(1) !== 0) bits.skip(8); // compr2
  }
  if (bits.read(1) === 0) {
    throw new Error('CMAF D0 is missing its required in-band chanmap.');
  }
  const channelMap = bits.read(16);
  if (channelMap === 0) throw new Error('CMAF D0 chanmap must contain at least one channel.');
  return channelMap;
}

/**
 * Validate I0/D0 frame envelope and, when supplied, bind in-band BSI to dec3.
 * Full audio-block/JOC metadata semantics remain the responsibility of the
 * pinned OpenJOC decoder/container validation.
 */
export function validateCmafEac3AccessUnit(
  bytes: Uint8Array,
  decoderConfig?: Ec3SpecificConfig | null,
): CmafEac3AccessUnitShape {
  if (bytes.byteLength < 6) throw new Error('E-AC-3 CMAF sample is too short to contain an access unit.');
  const frames: SyncframeHeader[] = [];
  const offsets: number[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const frame = parseHeader(bytes, offset);
    offsets.push(offset);
    frames.push(frame);
    if (frames.length > 2) {
      throw new Error('CMAF JOC access unit may contain only I0 and optional D0 syncframes.');
    }
    offset += frame.frameBytes;
  }
  if (offset !== bytes.byteLength || frames.length === 0) {
    throw new Error('E-AC-3 CMAF sample does not contain complete syncframes.');
  }
  const independent = frames[0];
  if (independent.streamType !== 0 || independent.substreamId !== 0) {
    throw new Error('CMAF JOC access unit must begin with independent substream I0.');
  }
  if (independent.sampleRateCode !== 0 || independent.blocksCode !== 3) {
    throw new Error('CMAF JOC requires 48 kHz syncframes with six audio blocks.');
  }
  if (frames.length === 1 && independent.bsid !== 16) {
    throw new Error('I0-only CMAF E-AC-3 requires bsid=16.');
  }
  if (frames.length === 2) {
    const dependent = frames[1];
    if (dependent.streamType !== 1 || dependent.substreamId !== 0) {
      throw new Error('The optional second CMAF syncframe must be dependent substream D0.');
    }
    if (dependent.sampleRateCode !== independent.sampleRateCode ||
        dependent.blocksCode !== independent.blocksCode || dependent.bsid !== 16) {
      throw new Error('CMAF D0 syncframe profile does not match the supported 48 kHz six-block profile.');
    }
    if (![6, 8, 16].includes(independent.bsid)) {
      throw new Error('I0+D0 CMAF E-AC-3 requires I0 bsid 6, 8, or 16.');
    }
    const channelMap = parseD0ChannelMap(bytes.subarray(offsets[1], offsets[1] + dependent.frameBytes));
    if (decoderConfig) {
      const configured = decoderConfig.independentSubstreams[0];
      if (!configured || configured.dependentSubstreams !== 1 || configured.chanLoc === null) {
        throw new Error('In-band D0 is not permitted by the dec3 dependent-substream configuration.');
      }
      validateD0ChannelMapAgainstDec3(channelMap, configured.chanLoc);
    }
  } else if (decoderConfig && decoderConfig.independentSubstreams[0]?.dependentSubstreams !== 0) {
    throw new Error('The dec3 track configuration requires D0 but the CMAF sample contains I0 only.');
  }

  if (decoderConfig) {
    const configured = decoderConfig.independentSubstreams[0];
    if (!configured || independent.bsid !== configured.bsid ||
        independent.acmod !== configured.acmod || independent.lfeOn !== configured.lfeOn) {
      throw new Error('In-band I0 bsid/acmod/lfeon disagrees with dec3 configuration.');
    }
  }
  return {
    syncframes: frames.length,
    hasDependentD0: frames.length === 2,
    independentBsid: independent.bsid,
  };
}
