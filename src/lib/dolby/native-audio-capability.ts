/**
 * Browser-declared audio codec support. This cannot attest to decoded audio,
 * channel layouts, JOC objects, bitstream passthrough or Atmos rendering.
 */
export type AudioCodecSupport = 'probably' | 'maybe' | 'no' | 'unknown';
export interface NativeDolbyAudioCapability {
  ac3: AudioCodecSupport;
  eac3: AudioCodecSupport;
  nativeDolbyAudioOutput: 'unverified';
  atmosObjectRendering: 'unverified';
}

export function probeNativeDolbyAudioCapability(canPlayType: (mime: string) => string): NativeDolbyAudioCapability {
  const check = (codec: 'ac-3' | 'ec-3'): AudioCodecSupport => {
    try {
      const result = canPlayType(`audio/mp4; codecs="${codec}"`);
      if (result === 'probably' || result === 'maybe') return result;
      return result === '' ? 'no' : 'unknown';
    } catch {
      return 'unknown';
    }
  };
  return {
    ac3: check('ac-3'),
    eac3: check('ec-3'),
    nativeDolbyAudioOutput: 'unverified',
    atmosObjectRendering: 'unverified',
  };
}
