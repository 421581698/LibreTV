import { describe, expect, it } from 'vitest';
import {
  classifyAudioVerification,
  createBrowserAudioEvidence,
  inspectBrowserAudioFeatures,
} from './dolby-audio-capabilities';

describe('inspectBrowserAudioFeatures', () => {
  it('reports API availability without claiming native Dolby support', () => {
    const features = inspectBrowserAudioFeatures({
      AudioContext: { prototype: { createMediaElementSource: () => undefined, audioWorklet: {} } },
      PannerNode: class PannerNode {},
      AudioWorkletNode: class AudioWorkletNode {},
      AudioDecoder: undefined,
      navigator: { mediaCapabilities: {} },
    });

    expect(features).toEqual({
      webAudio: true,
      mediaElementSource: true,
      hrtfPanner: true,
      audioWorklet: true,
      mediaCapabilitiesApi: true,
      webCodecsAudioDecoderApi: false,
    });
  });

  it('handles an environment without Web Audio APIs', () => {
    expect(inspectBrowserAudioFeatures({})).toEqual({
      webAudio: false,
      mediaElementSource: false,
      hrtfPanner: false,
      audioWorklet: false,
      mediaCapabilitiesApi: false,
      webCodecsAudioDecoderApi: false,
    });
  });
});

describe('classifyAudioVerification', () => {
  it('never treats a JOC marker as successful decoding', () => {
    const report = classifyAudioVerification(createBrowserAudioEvidence({
      codec: 'ec-3',
      inputChannels: 6,
      hasJocMarker: true,
    }));
    expect(report.status).toBe('joc-marker-only');
  });

  it('requires both JOC decode and object rendering evidence', () => {
    const base = createBrowserAudioEvidence({ hasJocMarker: true });
    expect(classifyAudioVerification({ ...base, jocDecode: 'verified' }).status).toBe('joc-marker-only');
    expect(classifyAudioVerification({
      ...base,
      jocDecode: 'verified',
      objectRendering: 'verified',
    }).status).toBe('joc-object-rendering-verified');
  });

  it('keeps binaural processing separate from Dolby object decoding', () => {
    const report = classifyAudioVerification(createBrowserAudioEvidence({
      inputChannels: 2,
      binauralProcessing: 'configured',
    }));
    expect(report.status).toBe('binaural-processing-configured');
    expect(report.detail).toContain('不是 Dolby Atmos');
  });

  it('requires explicit evidence for native Dolby output', () => {
    const base = createBrowserAudioEvidence({ inputChannels: 6 });
    expect(classifyAudioVerification(base).status).toBe('unknown');
    expect(classifyAudioVerification({ ...base, nativeDolbyOutput: 'verified' }).status)
      .toBe('native-dolby-output-verified');
  });

  it('classifies an ordinary stereo input without spatial processing', () => {
    expect(classifyAudioVerification(createBrowserAudioEvidence({ inputChannels: 2 })).status)
      .toBe('stereo-input');
  });

  it('does not infer native Dolby output from an E-AC-3 codec or multichannel declaration', () => {
    const report = classifyAudioVerification(createBrowserAudioEvidence({
      codec: 'ec-3',
      inputChannels: 6,
      hasJocMarker: false,
    }));
    expect(report.status).toBe('unknown');
    expect(report.label).toBe('音频输出状态未知');
  });

  it('gives verified native output precedence over metadata-only and DSP hints', () => {
    const base = createBrowserAudioEvidence({
      codec: 'ec-3',
      inputChannels: 6,
      hasJocMarker: true,
      binauralProcessing: 'configured',
    });
    expect(classifyAudioVerification({ ...base, nativeDolbyOutput: 'verified' }).status)
      .toBe('native-dolby-output-verified');
  });
});
