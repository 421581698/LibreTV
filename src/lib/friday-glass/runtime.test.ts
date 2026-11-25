import { describe, expect, it } from 'vitest';
import { GLASS_DEFAULTS, readGlassPreferences, selectGlassBackend } from './runtime';

const opticalDevice = {
  preferences: GLASS_DEFAULTS, contrast: false, transparency: false,
  forcedColors: false, backdrop: true, webkit: false, optical: true,
  playing: false, underPressure: false, failed: false,
};

describe('Friday glass rendering policy', () => {
  it('prioritizes accessibility and recovery over user quality preferences', () => {
    for (const flag of ['contrast', 'transparency', 'forcedColors', 'failed']) {
      expect(selectGlassBackend({ ...opticalDevice, [flag]: true })).toBe('safe');
    }
  });

  it('selects WebKit glass and reduces optics during playback or main-thread pressure', () => {
    expect(selectGlassBackend(opticalDevice)).toBe('optical');
    expect(selectGlassBackend({ ...opticalDevice, webkit: true })).toBe('webkit');
    expect(selectGlassBackend({ ...opticalDevice, playing: true })).toBe('native');
    expect(selectGlassBackend({ ...opticalDevice, underPressure: true })).toBe('native');
    expect(selectGlassBackend({ ...opticalDevice, backdrop: false })).toBe('safe');
  });

  it('validates persisted preferences and fills keys absent from previous settings', () => {
    expect(readGlassPreferences('bad JSON')).toEqual(GLASS_DEFAULTS);
    expect(readGlassPreferences('{"intensity":200,"motion":false,"quality":"bad"}'))
      .toEqual({ ...GLASS_DEFAULTS, intensity: 100, motion: false });
  });
});
