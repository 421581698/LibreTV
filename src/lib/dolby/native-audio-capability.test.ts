import { describe, expect, it } from 'vitest';
import { probeNativeDolbyAudioCapability } from './native-audio-capability';

describe('native AC-3 and E-AC-3 audio capability diagnostics', () => {
  it('probes both codec declarations without claiming actual Dolby output', () => {
    const queries: string[] = [];
    const report = probeNativeDolbyAudioCapability(mime => {
      queries.push(mime);
      return mime.includes('ec-3') ? 'probably' : 'maybe';
    });
    expect(queries).toEqual(['audio/mp4; codecs="ac-3"', 'audio/mp4; codecs="ec-3"']);
    expect(report.ac3).toBe('maybe');
    expect(report.eac3).toBe('probably');
    expect(report.nativeDolbyAudioOutput).toBe('unverified');
    expect(report.atmosObjectRendering).toBe('unverified');
  });
  it('keeps explicit rejections and API failures distinct', () => {
    const report = probeNativeDolbyAudioCapability(mime => {
      if (mime.includes('ac-3')) return '';
      throw Error('unsupported');
    });
    expect(report.ac3).toBe('no');
    expect(report.eac3).toBe('unknown');
  });
});
