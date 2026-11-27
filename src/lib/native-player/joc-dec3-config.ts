/**
 * ISO BMFF EC3SpecificBox (dec3) parser and OpenJOC CMAF-JOC profile gate.
 * Parsing this box establishes container configuration only; sample-level
 * E-AC-3 BSI and D0 chanmap agreement must still be checked per access unit.
 */
export interface Ec3SubstreamConfig {
  readonly fscod: number;
  readonly bsid: number;
  readonly asvc: boolean;
  readonly bsmod: number;
  readonly acmod: number;
  readonly lfeOn: boolean;
  readonly dependentSubstreams: number;
  readonly chanLoc: number | null;
}

export interface Ec3SpecificConfig {
  readonly dataRateKbps: number;
  readonly independentSubstreams: readonly Ec3SubstreamConfig[];
  readonly flagEc3ExtensionTypeA: boolean;
  readonly complexityIndexTypeA: number;
}

class BitReader {
  private position = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get remaining(): number { return this.bytes.length * 8 - this.position; }
  read(width: number): number {
    if (!Number.isInteger(width) || width < 0 || width > 24 || this.remaining < width) {
      throw new Error('Malformed dec3 configuration: truncated bit field.');
    }
    let value = 0;
    for (let i = 0; i < width; i += 1) {
      const byte = this.bytes[this.position >> 3];
      value = (value << 1) | ((byte >> (7 - (this.position & 7))) & 1);
      this.position += 1;
    }
    return value;
  }
  expectZero(width: number, field: string): void {
    if (this.read(width) !== 0) throw new Error(`Malformed dec3 configuration: ${field} must be zero.`);
  }
}

export function parseEc3SpecificBox(input: Uint8Array): Ec3SpecificConfig {
  if (input.byteLength < 11) throw new Error('Malformed dec3 configuration: box is too short.');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const size = view.getUint32(0, false);
  if (size !== input.byteLength || String.fromCharCode(...input.subarray(4, 8)) !== 'dec3') {
    throw new Error('Malformed dec3 configuration: expected exactly one complete dec3 box.');
  }
  const reader = new BitReader(input.subarray(8));
  const dataRateKbps = reader.read(13);
  const independentCount = reader.read(3) + 1;
  const independentSubstreams: Ec3SubstreamConfig[] = [];
  for (let index = 0; index < independentCount; index += 1) {
    const fscod = reader.read(2);
    const bsid = reader.read(5);
    reader.expectZero(1, 'reserved substream bit');
    const asvc = reader.read(1) !== 0;
    const bsmod = reader.read(3);
    const acmod = reader.read(3);
    const lfeOn = reader.read(1) !== 0;
    reader.expectZero(3, 'reserved substream bits');
    const dependentSubstreams = reader.read(4);
    let chanLoc: number | null = null;
    if (dependentSubstreams > 0) chanLoc = reader.read(9);
    else reader.expectZero(1, 'reserved channel-location bit');
    independentSubstreams.push({
      fscod, bsid, asvc, bsmod, acmod, lfeOn, dependentSubstreams, chanLoc,
    });
  }

  let flagEc3ExtensionTypeA = false;
  let complexityIndexTypeA = 0;
  if (reader.remaining !== 0) {
    if (reader.remaining % 8 !== 0) {
      throw new Error('Malformed dec3 configuration: trailing fields are not byte-aligned.');
    }
    if (reader.remaining === 8) {
      reader.expectZero(8, 'reserved extension byte');
    } else {
      reader.expectZero(7, 'reserved extension bits');
      flagEc3ExtensionTypeA = reader.read(1) !== 0;
      complexityIndexTypeA = reader.read(8);
      if (!flagEc3ExtensionTypeA && complexityIndexTypeA !== 0) {
        throw new Error('Malformed dec3 configuration: complexity requires type-A extension.');
      }
      while (reader.remaining > 0) reader.expectZero(8, 'reserved extension byte');
    }
  }
  return { dataRateKbps, independentSubstreams, flagEc3ExtensionTypeA, complexityIndexTypeA };
}

export interface CmafJocTrackFacts {
  readonly sampleEntry: string;
  readonly timescale: number;
  readonly sampleRate: number;
  readonly decoderConfig: Ec3SpecificConfig | null;
}

/** Throws unless the track matches the pinned OpenJOC CMAF-JOC profile. */
export function validateCmafJocTrackConfiguration(facts: CmafJocTrackFacts): Ec3SpecificConfig {
  if (facts.sampleEntry !== 'ec-3') throw new Error('CMAF JOC requires the ec-3 sample entry.');
  const config = facts.decoderConfig;
  if (!config) throw new Error('CMAF JOC requires a dec3 decoder configuration.');
  if (facts.timescale !== facts.sampleRate) throw new Error('CMAF E-AC-3 timescale must equal the sample rate.');
  if (facts.sampleRate !== 48_000) throw new Error('OpenJOC CMAF JOC requires 48000 Hz.');
  if (config.independentSubstreams.length !== 1) {
    throw new Error('CMAF JOC requires exactly one independent substream.');
  }
  if (!config.flagEc3ExtensionTypeA) throw new Error('CMAF JOC requires the dec3 type-A JOC extension signal.');
  if (config.complexityIndexTypeA > 16) throw new Error('CMAF JOC complexity index must not exceed 16.');
  if (config.dataRateKbps > 3024) throw new Error('CMAF JOC bitrate must not exceed 3024 kbps.');
  const independent = config.independentSubstreams[0];
  if (independent.fscod !== 0 || independent.acmod === 0) {
    throw new Error('CMAF JOC requires fscod=0 and forbids acmod=0.');
  }
  if (independent.dependentSubstreams > 1) {
    throw new Error('CMAF JOC permits at most one dependent substream D0.');
  }
  if (independent.dependentSubstreams === 0 && independent.bsid !== 16) {
    throw new Error('I0-only CMAF E-AC-3 requires bsid=16.');
  }
  if (independent.dependentSubstreams === 1) {
    if (independent.chanLoc === null || independent.chanLoc === 0) {
      throw new Error('CMAF D0 requires a non-empty dec3 chan_loc.');
    }
    if (![6, 8, 16].includes(independent.bsid)) {
      throw new Error('I0+D0 CMAF E-AC-3 requires I0 bsid 6, 8, or 16.');
    }
  }
  return config;
}

/** Map the supported E-AC-3 D0 chanmap to dec3 chan_loc bit positions. */
export function eac3ChannelMapToChanLoc(channelMap: number): number {
  if (!Number.isInteger(channelMap) || channelMap <= 0 || channelMap > 0xffff) {
    throw new Error('D0 channel map must be a non-empty 16-bit value.');
  }
  if ((channelMap & 0x0005) !== 0) {
    throw new Error('D0 channel map contains a position unsupported by CMAF chan_loc.');
  }
  let chanLoc = 0;
  for (const [channelMapBit, chanLocBit] of [
    [5, 0], [6, 1], [7, 2], [8, 3], [9, 4], [10, 5], [11, 6], [12, 7], [14, 8],
  ]) {
    if ((channelMap & (1 << (15 - channelMapBit))) !== 0) chanLoc |= 1 << chanLocBit;
  }
  return chanLoc;
}

export function validateD0ChannelMapAgainstDec3(channelMap: number, chanLoc: number): void {
  if (eac3ChannelMapToChanLoc(channelMap) !== chanLoc) {
    throw new Error('D0 chanmap disagrees with dec3 chan_loc.');
  }
}
