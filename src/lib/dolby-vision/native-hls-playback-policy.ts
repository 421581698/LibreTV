import type { DolbyVisionFormatReport } from './format-inspector';

/**
 * Select a browser-native HLS delivery path for declared Dolby Vision on
 * Apple Safari. This is a delivery policy, not confirmation of Dolby decode.
 *
 * Some modern Safari releases support hls.js through Managed Media Source,
 * so Hls.isSupported() alone cannot decide the appropriate DV delivery path.
 */
export function shouldPreferNativeDolbyVisionHls(
  report: Pick<DolbyVisionFormatReport, 'detected' | 'container'>,
  options: {
    userAgent: string;
    nativeHlsTypeSupport: string;
    qualityPreference: string;
    playbackStarted: boolean;
    alreadyAttemptedNative: boolean;
  },
): boolean {
  if (!report.detected || report.container !== 'hls' ||
      options.qualityPreference !== 'auto' || options.playbackStarted ||
      options.alreadyAttemptedNative) return false;

  if (options.nativeHlsTypeSupport !== 'maybe' && options.nativeHlsTypeSupport !== 'probably') {
    return false;
  }

  // Limit the automatic handoff to Safari: other browsers retain hls.js.
  // UA is only a routing heuristic, never a Dolby playback capability proof.
  const userAgent = options.userAgent;
  return /AppleWebKit\/\d/.test(userAgent) && /Safari\/\d/.test(userAgent) &&
    !/(?:Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|OPiOS|SamsungBrowser)\//.test(userAgent);
}
