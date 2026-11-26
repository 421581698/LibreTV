import { describe, expect, it, vi } from 'vitest';
import { shouldPreferNativeDolbyAudioHls } from './native-audio-hls-policy';

const safari = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile Safari/604.1';
const base = {
  userAgent: safari, nativeHlsTypeSupport: 'maybe',
  canPlayAudioCodec: vi.fn(() => 'probably'),
  qualityPreference: 'auto', playbackStarted: false, alreadyAttemptedNative: false,
};

describe('Safari native HLS delivery for advertised Dolby audio', () => {
  it('enables supported AC-3/E-AC-3 only before playback and without a manual quality lock', () => {
    expect(shouldPreferNativeDolbyAudioHls(['ec-3'], base)).toBe(true);
    expect(shouldPreferNativeDolbyAudioHls(['ac-3'], base)).toBe(true);
    expect(shouldPreferNativeDolbyAudioHls(['mp4a.40.2'], base)).toBe(false);
    expect(shouldPreferNativeDolbyAudioHls(['ec-3'], { ...base, qualityPreference: '1080' })).toBe(false);
    expect(shouldPreferNativeDolbyAudioHls(['ec-3'], { ...base, playbackStarted: true })).toBe(false);
    expect(shouldPreferNativeDolbyAudioHls(['ec-3'], { ...base, alreadyAttemptedNative: true })).toBe(false);
  });
  it('never routes Chrome, unsupported HLS, or codec rejection to native Dolby audio', () => {
    expect(shouldPreferNativeDolbyAudioHls(['ec-3'], { ...base, userAgent: safari + ' CriOS/123.0' })).toBe(false);
    expect(shouldPreferNativeDolbyAudioHls(['ec-3'], { ...base, nativeHlsTypeSupport: '' })).toBe(false);
    expect(shouldPreferNativeDolbyAudioHls(['ec-3'], { ...base, canPlayAudioCodec: () => '' })).toBe(false);
    expect(shouldPreferNativeDolbyAudioHls(['ec-3'], { ...base, canPlayAudioCodec: () => { throw Error('unsupported'); } })).toBe(false);
  });
});
