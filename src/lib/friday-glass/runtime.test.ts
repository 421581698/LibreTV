import { describe, expect, it } from 'vitest';
import { GLASS_DEFAULTS, GLASS_MATERIALS, readGlassPreferences, selectGlassBackend } from './runtime';

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
    expect(selectGlassBackend({ ...opticalDevice, webkit: true, underPressure: true })).toBe('native');
    expect(selectGlassBackend({ ...opticalDevice, webkit: true, playing: true })).toBe('native');
    expect(selectGlassBackend({ ...opticalDevice, playing: true })).toBe('native');
    expect(selectGlassBackend({ ...opticalDevice, underPressure: true })).toBe('native');
    expect(selectGlassBackend({ ...opticalDevice, backdrop: false })).toBe('safe');
  });

  it('supports six distinct materials and all theme modes across older saved preferences', () => {
    expect(GLASS_MATERIALS).toEqual(['regular', 'clear', 'frosted', 'cinema', 'ambient', 'solid']);
    for (const material of GLASS_MATERIALS) {
      expect(readGlassPreferences(JSON.stringify({ material })).material).toBe(material);
    }
    for (const theme of ['system', 'light', 'dark']) {
      expect(readGlassPreferences(JSON.stringify({ theme })).theme).toBe(theme);
    }
    expect(readGlassPreferences('{"theme":"invalid","material":"invalid"}')).toEqual(GLASS_DEFAULTS);
  });

  it('validates persisted preferences and fills keys absent from previous settings', () => {
    expect(readGlassPreferences('bad JSON')).toEqual(GLASS_DEFAULTS);
    expect(readGlassPreferences('{"intensity":200,"motion":false,"quality":"bad"}'))
      .toEqual({ ...GLASS_DEFAULTS, intensity: 100, motion: false });
  });
});
