import type { DolbyVisionFormatReport } from './format-inspector';

/**
 * Browser capability signals only. These APIs do not expose decoded RPU,
 * the selected HLS rendition, hardware bitstream passthrough, or HDR output.
 */
export type NativeMediaSupport = 'probably' | 'maybe' | 'no' | 'unknown';

export interface DolbyVisionNativeCapabilityReport {
  nativeHls: NativeMediaSupport;
  /** Each entry is a declaration probe, NOT evidence of the selected stream. */
  codecs: Array<{
    codec: string;
    profile: number;
    family: string;
    support: NativeMediaSupport;
  }>;
  /** CSS media-query hint; this is not a measurement of HDR pixels. */
  hdrDisplayHint: 'high' | 'standard' | 'unknown';
  /** Deliberately impossible to promote a capability query into output proof. */
  actualDolbyVisionOutput: 'unverified';
  dynamicMetadataRendered: 'unverified';
  bitstreamPassthrough: 'unverified';
}

type CanPlayType = (type: string) => string;
type MatchMedia = (query: string) => { matches: boolean };

function safeCanPlay(canPlayType: CanPlayType, type: string): NativeMediaSupport {
  try {
    const value = canPlayType(type);
    if (value === 'probably' || value === 'maybe') return value;
    return value === '' ? 'no' : 'unknown';
  } catch {
    return 'unknown';
  }
}

function combinedHlsSupport(canPlayType: CanPlayType): NativeMediaSupport {
  const values = [
    safeCanPlay(canPlayType, 'application/vnd.apple.mpegurl'),
    safeCanPlay(canPlayType, 'application/x-mpegURL'),
  ];
  if (values.includes('probably')) return 'probably';
  if (values.includes('maybe')) return 'maybe';
  if (values.every((value) => value === 'no')) return 'no';
  return 'unknown';
}

/** Read actual browser API results without inferring successful playback. */
export function probeNativeDolbyVisionCapabilities(
  report: DolbyVisionFormatReport,
  canPlayType: CanPlayType,
  matchMedia?: MatchMedia,
): DolbyVisionNativeCapabilityReport {
  let hdrDisplayHint: DolbyVisionNativeCapabilityReport['hdrDisplayHint'] = 'unknown';
  if (matchMedia) {
    try {
      hdrDisplayHint = matchMedia('(dynamic-range: high)').matches ? 'high' : 'standard';
    } catch {
      // Unsupported media query surface: no HDR verdict.
    }
  }

  return {
    nativeHls: combinedHlsSupport(canPlayType),
    codecs: report.declarations.map(({ raw, profile, family }) => ({
      codec: raw,
      profile,
      family,
      support: safeCanPlay(canPlayType, `video/mp4; codecs="${raw}"`),
    })),
    hdrDisplayHint,
    actualDolbyVisionOutput: 'unverified',
    dynamicMetadataRendered: 'unverified',
    bitstreamPassthrough: 'unverified',
  };
}
