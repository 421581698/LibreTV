import {
  inspectDolbyVisionFormat,
  type DolbyVisionFormatReport,
} from './format-inspector';

export interface HlsDolbyVisionLevelLike {
  videoCodec?: string | null;
  attrs?: unknown;
}

/**
 * Inspect original HLS level attributes as well as hls.js's normalized
 * videoCodec. The original attributes preserve supplemental codec signaling.
 */
export function inspectHlsDolbyVisionFormat(
  url: string,
  levels: HlsDolbyVisionLevelLike[],
): DolbyVisionFormatReport {
  const codecs: string[] = [];
  const supplementalCodecs: string[] = [];

  for (const level of levels) {
    if (typeof level.videoCodec === 'string' && level.videoCodec) {
      codecs.push(level.videoCodec);
    }
    if (!level.attrs || typeof level.attrs !== 'object') continue;

    const attrs = level.attrs as Record<string, unknown>;
    if (typeof attrs.CODECS === 'string') codecs.push(attrs.CODECS);
    if (typeof attrs['SUPPLEMENTAL-CODECS'] === 'string') {
      supplementalCodecs.push(attrs['SUPPLEMENTAL-CODECS']);
    }
  }

  return inspectDolbyVisionFormat({ url, codecs, supplementalCodecs });
}
