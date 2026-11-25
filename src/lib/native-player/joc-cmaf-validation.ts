/**
 * Structural admission checks for one ETSI E-AC-3 CMAF sample.
 *
 * CMAF JOC samples carry exactly one complete 1536-sample access unit:
 * independent I0, optionally followed by dependent D0. This deliberately
 * validates syncframe boundaries and the constrained stream-type layout only;
 * it does not replace dec3/JOC metadata validation or OpenJOC bitstream parsing.
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
  const bsid = (bytes[offset + 5] >> 3) & 0x1f;
  if (frameBytes < 6 || offset + frameBytes > bytes.length) {
    throw new Error('E-AC-3 CMAF syncframe exceeds the sample boundary.');
  }
  return { streamType, substreamId, frameBytes, sampleRateCode, blocksCode, bsid };
}

/**
 * Validate the syncframe envelope for the OpenJOC CMAF subset (I0 or I0+D0).
 * Full audio syntax, D0 channel-map/chan_loc agreement, dec3 and JOC metadata
 * are still validated by the decoder/container layer and real-media tests.
 */
export function validateCmafEac3AccessUnit(bytes: Uint8Array): CmafEac3AccessUnitShape {
  if (bytes.byteLength < 6) throw new Error('E-AC-3 CMAF sample is too short to contain an access unit.');
  const frames: SyncframeHeader[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const frame = parseHeader(bytes, offset);
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
  }
  return {
    syncframes: frames.length,
    hasDependentD0: frames.length === 2,
    independentBsid: independent.bsid,
  };
}
