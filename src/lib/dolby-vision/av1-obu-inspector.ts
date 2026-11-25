/**
 * Bounded AV1 OBU structural inspection for Dolby Vision research.
 *
 * This deliberately identifies metadata OBUs and ITU-T T.35 payload presence
 * only. It does NOT identify Dolby's provider payload, parse EMDF, extract RPU,
 * or establish Dolby Vision support.
 */
export interface Av1ObuInspectionOptions {
  maxObuPayloadBytes?: number;
  maxObus?: number;
}

export interface Av1ObuInspectionReport {
  valid: boolean;
  obuCount: number;
  metadataObuCount: number;
  ituT35MetadataObuCount: number;
  frameHeaderObuCount: number;
  frameObuCount: number;
  temporalDelimiterCount: number;
  rpuPresence: 'unknown';
  errors: string[];
}

function readLeb128(data: Uint8Array, start: number, end: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  for (let index = start; index < end && index < start + 8; index += 1) {
    const byte = data[index];
    value += (byte & 0x7f) * (2 ** shift);
    if (!Number.isSafeInteger(value)) return null;
    if ((byte & 0x80) === 0) return { value, next: index + 1 };
    shift += 7;
  }
  return null;
}

/** Inspect a raw low-overhead AV1 OBU stream without allocating from untrusted lengths. */
export function inspectAv1ObuStream(
  data: Uint8Array,
  options: Av1ObuInspectionOptions = {},
): Av1ObuInspectionReport {
  const maxPayload = options.maxObuPayloadBytes ?? 16 * 1024 * 1024;
  const maxObus = options.maxObus ?? 100_000;
  const errors: string[] = [];
  let offset = 0;
  let obuCount = 0;
  let metadataObuCount = 0;
  let ituT35MetadataObuCount = 0;
  let frameHeaderObuCount = 0;
  let frameObuCount = 0;
  let temporalDelimiterCount = 0;

  if (!Number.isSafeInteger(maxPayload) || maxPayload < 1 || !Number.isSafeInteger(maxObus) || maxObus < 1) {
    return { valid: false, obuCount, metadataObuCount, ituT35MetadataObuCount, frameHeaderObuCount, frameObuCount, temporalDelimiterCount, rpuPresence: 'unknown', errors: ['Invalid inspection limits.'] };
  }

  while (offset < data.length) {
    if (obuCount >= maxObus) {
      errors.push('OBU count exceeds configured limit.');
      break;
    }
    const header = data[offset++];
    if ((header & 0x80) !== 0 || (header & 0x01) !== 0) {
      errors.push('Invalid OBU forbidden or reserved header bit.');
      break;
    }
    const type = (header >> 3) & 0x0f;
    const extensionPresent = (header & 0x04) !== 0;
    const hasSizeField = (header & 0x02) !== 0;
    if (!hasSizeField) {
      errors.push('OBU without an explicit size field is not accepted in bounded elementary-stream mode.');
      break;
    }
    if (extensionPresent) {
      if (offset >= data.length) {
        errors.push('Truncated OBU extension header.');
        break;
      }
      const extension = data[offset++];
      if ((extension & 0x07) !== 0) {
        errors.push('Invalid OBU extension reserved bits.');
        break;
      }
    }
    const length = readLeb128(data, offset, data.length);
    if (!length) {
      errors.push('Truncated or overlong OBU size LEB128.');
      break;
    }
    offset = length.next;
    if (length.value > maxPayload) {
      errors.push('OBU payload exceeds configured size limit.');
      break;
    }
    if (length.value > data.length - offset) {
      errors.push('OBU payload is truncated.');
      break;
    }
    const payloadStart = offset;
    const payloadEnd = offset + length.value;
    if (type === 5) {
      metadataObuCount += 1;
      const metadataType = readLeb128(data, payloadStart, payloadEnd);
      if (!metadataType) {
        errors.push('Metadata OBU has a truncated or invalid metadata_type.');
        break;
      }
      if (metadataType.value === 4) ituT35MetadataObuCount += 1;
    } else if (type === 3) {
      frameHeaderObuCount += 1;
    } else if (type === 6) {
      frameObuCount += 1;
    } else if (type === 2) {
      temporalDelimiterCount += 1;
    }
    obuCount += 1;
    offset = payloadEnd;
  }

  return {
    valid: errors.length === 0 && offset === data.length,
    obuCount,
    metadataObuCount,
    ituT35MetadataObuCount,
    frameHeaderObuCount,
    frameObuCount,
    temporalDelimiterCount,
    rpuPresence: 'unknown',
    errors,
  };
}
