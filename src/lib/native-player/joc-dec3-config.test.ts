import { describe, expect, it } from 'vitest';
import {
  eac3ChannelMapToChanLoc,
  parseEc3SpecificBox,
  validateCmafJocTrackConfiguration,
  validateD0ChannelMapAgainstDec3,
} from './joc-dec3-config';

function dec3Box(options: {
  dataRate?: number;
  fscod?: number;
  bsid?: number;
  acmod?: number;
  dependent?: number;
  chanLoc?: number;
  extension?: boolean;
  complexity?: number;
  independentCount?: number;
  trailingReserved?: number;
} = {}): Uint8Array {
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let shift = width - 1; shift >= 0; shift -= 1) bits.push((value >> shift) & 1);
  };
  push(options.dataRate ?? 768, 13);
  push((options.independentCount ?? 1) - 1, 3);
  for (let index = 0; index < (options.independentCount ?? 1); index += 1) {
    push(options.fscod ?? 0, 2);
    push(options.bsid ?? 16, 5);
    push(0, 1);
    push(0, 1);
    push(0, 3);
    push(options.acmod ?? 7, 3);
    push(0, 1);
    push(0, 3);
    push(options.dependent ?? 0, 4);
    if ((options.dependent ?? 0) > 0) push(options.chanLoc ?? 1, 9);
    else push(0, 1);
  }
  if (options.extension !== false) {
    push(0, 7);
    push(1, 1);
    push(options.complexity ?? 8, 8);
  }
  if (options.trailingReserved) push(0, options.trailingReserved);
  while (bits.length % 8) bits.push(0);
  const payload = new Uint8Array(bits.length / 8);
  bits.forEach((bit, index) => { payload[index >> 3] |= bit << (7 - (index & 7)); });
  const result = new Uint8Array(8 + payload.length);
  new DataView(result.buffer).setUint32(0, result.length, false);
  result.set([0x64, 0x65, 0x63, 0x33], 4);
  result.set(payload, 8);
  return result;
}

describe('OpenJOC CMAF dec3 configuration', () => {
  it('parses a JOC I0-only configuration and validates the track profile', () => {
    const config = parseEc3SpecificBox(dec3Box());
    expect(config).toMatchObject({
      dataRateKbps: 768,
      flagEc3ExtensionTypeA: true,
      complexityIndexTypeA: 8,
      independentSubstreams: [{ fscod: 0, bsid: 16, acmod: 7, dependentSubstreams: 0, chanLoc: null }],
    });
    expect(validateCmafJocTrackConfiguration({
      sampleEntry: 'ec-3', timescale: 48_000, sampleRate: 48_000, decoderConfig: config,
    })).toBe(config);
  });

  it('requires a single I0 and permits only one configured D0', () => {
    const config = parseEc3SpecificBox(dec3Box({ bsid: 8, dependent: 1, chanLoc: 0x100 }));
    expect(config.independentSubstreams[0]).toMatchObject({ bsid: 8, dependentSubstreams: 1, chanLoc: 0x100 });
    expect(() => validateCmafJocTrackConfiguration({
      sampleEntry: 'ec-3', timescale: 48_000, sampleRate: 48_000, decoderConfig: config,
    })).not.toThrow();
    expect(() => validateCmafJocTrackConfiguration({
      sampleEntry: 'ec-3', timescale: 48_000, sampleRate: 48_000,
      decoderConfig: parseEc3SpecificBox(dec3Box({ dependent: 2, chanLoc: 0x100 })),
    })).toThrow(/at most one/i);
    expect(() => validateCmafJocTrackConfiguration({
      sampleEntry: 'ec-3', timescale: 48_000, sampleRate: 48_000,
      decoderConfig: parseEc3SpecificBox(dec3Box({ independentCount: 2 })),
    })).toThrow(/exactly one independent/i);
  });

  it('rejects missing JOC signaling, invalid complexity, bitrate and track clocks', () => {
    const noExtension = parseEc3SpecificBox(dec3Box({ extension: false }));
    expect(() => validateCmafJocTrackConfiguration({
      sampleEntry: 'ec-3', timescale: 48_000, sampleRate: 48_000, decoderConfig: noExtension,
    })).toThrow(/extension signal/i);
    expect(() => validateCmafJocTrackConfiguration({
      sampleEntry: 'ec-3', timescale: 48_000, sampleRate: 48_000,
      decoderConfig: parseEc3SpecificBox(dec3Box({ complexity: 17 })),
    })).toThrow(/complexity/i);
    expect(() => validateCmafJocTrackConfiguration({
      sampleEntry: 'ec-3', timescale: 48_000, sampleRate: 48_000,
      decoderConfig: parseEc3SpecificBox(dec3Box({ dataRate: 3025 })),
    })).toThrow(/bitrate/i);
    expect(() => validateCmafJocTrackConfiguration({
      sampleEntry: 'ec-3', timescale: 44_100, sampleRate: 48_000,
      decoderConfig: parseEc3SpecificBox(dec3Box()),
    })).toThrow(/timescale/i);
  });

  it('rejects malformed box framing and non-zero reserved bits', () => {
    const valid = dec3Box();
    expect(() => parseEc3SpecificBox(valid.subarray(0, valid.length - 1))).toThrow(/box|truncated/i);
    const bad = valid.slice();
    bad[10] |= 0x01;
    expect(() => parseEc3SpecificBox(bad)).toThrow(/reserved/i);
  });

  it('maps D0 channel positions and checks exact dec3 chan_loc agreement', () => {
    expect(eac3ChannelMapToChanLoc(0x0400)).toBe(1);
    expect(() => validateD0ChannelMapAgainstDec3(0x0400, 2)).toThrow(/disagrees/i);
    expect(() => eac3ChannelMapToChanLoc(0x0001)).toThrow(/unsupported/i);
  });
});
