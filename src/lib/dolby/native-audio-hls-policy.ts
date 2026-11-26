/**
 * Prefer a browser-native HLS decode path only when a manifest advertises
 * a Dolby audio codec and Safari declares support. This is routing, NOT proof
 * of AC-3/E-AC-3 decoding, Atmos objects, bitstream passthrough or HDR.
 */
export function shouldPreferNativeDolbyAudioHls(
  declaredAudioCodecs: readonly (string | undefined | null)[],
  options: {
    userAgent: string;
    nativeHlsTypeSupport: string;
    canPlayAudioCodec: (codec: 'ac-3' | 'ec-3') => string;
    qualityPreference: string;
    playbackStarted: boolean;
    alreadyAttemptedNative: boolean;
  },
): boolean {
  if (options.qualityPreference !== 'auto' || options.playbackStarted ||
      options.alreadyAttemptedNative ||
      !['probably', 'maybe'].includes(options.nativeHlsTypeSupport)) return false;

  // Chrome-family browsers, including alternate iOS shells, retain hls.js.
  const ua = options.userAgent;
  if (!/AppleWebKit\/\d/.test(ua) || !/Safari\/\d/.test(ua) ||
      /(?:Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|OPiOS|SamsungBrowser)\//.test(ua)) return false;

  const codecs = new Set(declaredAudioCodecs.map(value => (value ?? '').trim().toLowerCase())
    .filter((value): value is 'ac-3' | 'ec-3' => value === 'ac-3' || value === 'ec-3'));
  for (const codec of codecs) {
    try {
      const support = options.canPlayAudioCodec(codec);
      if (support === 'probably' || support === 'maybe') return true;
    } catch {
      // Fail closed when an API is missing or throws.
    }
  }
  return false;
}
