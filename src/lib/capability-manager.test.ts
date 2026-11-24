import { describe, expect, it, vi } from 'vitest';
import { assessCodecCapability, inspectAudioCapabilities } from './capability-manager';

describe('inspectAudioCapabilities', () => {
  it('identifies Safari without claiming Atmos or passthrough support', () => {
    const profile = inspectAudioCapabilities({
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
      audioContextAvailable: true,
      mediaSourceAvailable: true,
      mediaCapabilitiesAvailable: true,
      outputMaxChannels: 2,
      outputLatencyMs: 40,
    });
    expect(profile).toMatchObject({
      browserFamily: 'safari', audioContext: true, outputMaxChannels: 2,
      nativeDolbyDecode: 'unknown', bitstreamPassthrough: 'unknown',
    });
  });

  it('keeps unavailable and unknown values conservative', () => {
    expect(inspectAudioCapabilities({
      audioContextAvailable: false, mediaSourceAvailable: false, mediaCapabilitiesAvailable: false,
    })).toMatchObject({
      browserFamily: 'unknown', outputMaxChannels: null, outputLatencyMs: null,
      nativeDolbyDecode: 'unknown', bitstreamPassthrough: 'unknown',
    });
  });
});

describe('assessCodecCapability', () => {
  it('reports canPlayType only as a hint', () => {
    const canPlayType = vi.fn(() => 'probably');
    const assessment = assessCodecCapability('eac3', 'dolby-digital-plus', 'audio/mp4; codecs="ec-3"', {
      audioContextAvailable: true, mediaSourceAvailable: true, mediaCapabilitiesAvailable: true, canPlayType,
    });
    expect(assessment).toMatchObject({
      browserDecode: 'can-play-hint',
      atmosObjectDecode: 'not-established',
      bitstreamPassthrough: 'not-established',
      safeDefault: 'native-media-playback',
    });
    expect(canPlayType).toHaveBeenCalledOnce();
  });

  it('does not infer Atmos support from a Dolby metadata label', () => {
    const result = assessCodecCapability('eac3', 'dolby-atmos-metadata', 'audio/mp4', {
      audioContextAvailable: true, mediaSourceAvailable: true, mediaCapabilitiesAvailable: true,
    });
    expect(result.atmosObjectDecode).toBe('not-established');
    expect(result.notes.join(' ')).toContain('未验证 Dolby 位流直通');
  });

  it('keeps AC-4 browser support as a hint and never establishes Atmos decode', () => {
    const result = assessCodecCapability('ac4', 'dolby-ac4', 'audio/mp4; codecs="ac-4.02.01.04"', {
      audioContextAvailable: true, mediaSourceAvailable: true, mediaCapabilitiesAvailable: true, canPlayType: () => 'probably',
    });
    expect(result).toMatchObject({ browserDecode: 'can-play-hint', atmosObjectDecode: 'not-established', bitstreamPassthrough: 'not-established', safeDefault: 'native-media-playback' });
  });

  it('distinguishes an explicit negative browser hint', () => {
    expect(assessCodecCapability('truehd', 'dolby-truehd', 'audio/matroska', {
      audioContextAvailable: false, mediaSourceAvailable: false, mediaCapabilitiesAvailable: false,
      canPlayType: () => '',
    }).browserDecode).toBe('cannot-play-hint');
  });
});
