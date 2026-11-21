import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_PREFERENCES,
  loadSubtitlePreferences,
  normalizeSubtitlePreferences,
  saveSubtitlePreferences,
  subtitlePreferenceKey,
  type SubtitleStorage,
} from './subtitle-preferences';

function createStorage(): SubtitleStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('subtitle preferences', () => {
  it('scopes preferences by source and episode', () => {
    expect(subtitlePreferenceKey('source A', 'episode/2')).not.toBe(subtitlePreferenceKey('source A', 'episode/3'));
    expect(subtitlePreferenceKey('source A', 'episode/2')).not.toBe(subtitlePreferenceKey('source B', 'episode/2'));
  });

  it('persists normalized subtitle settings', () => {
    const storage = createStorage();
    const preferences = {
      enabled: false,
      selectedTrackId: 'sub-en',
      delayMs: 250,
      fontSizePercent: 125,
      backgroundOpacityPercent: 20,
    };
    expect(saveSubtitlePreferences(storage, preferences, 'src', 'ep1')).toBe(true);
    expect(loadSubtitlePreferences(storage, 'src', 'ep1')).toEqual(preferences);
    expect(loadSubtitlePreferences(storage, 'src', 'ep2')).toEqual(DEFAULT_SUBTITLE_PREFERENCES);
  });

  it('clamps untrusted persisted values to safe UI bounds', () => {
    expect(normalizeSubtitlePreferences({
      enabled: true,
      selectedTrackId: 'x',
      delayMs: 999_999,
      fontSizePercent: 999,
      backgroundOpacityPercent: -10,
    })).toEqual({
      enabled: true,
      selectedTrackId: 'x',
      delayMs: 10_000,
      fontSizePercent: 200,
      backgroundOpacityPercent: 0,
    });
  });

  it('uses defaults when storage is unavailable or contains invalid JSON', () => {
    const broken = {
      getItem: () => '{invalid',
      setItem: () => { throw new Error('quota'); },
    };
    expect(loadSubtitlePreferences(broken)).toEqual(DEFAULT_SUBTITLE_PREFERENCES);
    expect(saveSubtitlePreferences(broken, DEFAULT_SUBTITLE_PREFERENCES)).toBe(false);
  });
});
