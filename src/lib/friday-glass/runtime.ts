export type GlassMaterial = 'regular' | 'clear' | 'frosted' | 'cinema' | 'ambient' | 'solid';
export type GlassBackend = 'optical' | 'webkit' | 'native' | 'safe';
export type GlassTheme = 'system' | 'light' | 'dark';

export const GLASS_MATERIALS: readonly GlassMaterial[] = [
  'regular', 'clear', 'frosted', 'cinema', 'ambient', 'solid',
];

export const GLASS_DEFAULTS = {
  material: 'regular' as GlassMaterial,
  theme: 'system' as GlassTheme,
  quality: 'auto' as 'auto' | 'optical' | 'native' | 'safe',
  intensity: 65,
  motion: true,
  ambient: true,
  cinemaDark: true,
  playbackProtection: true,
};

export type GlassPreferences = typeof GLASS_DEFAULTS;

/** Old V1.1 records lack theme and the three additional materials. Keep them compatible. */
export function readGlassPreferences(raw: string | null): GlassPreferences {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object') return { ...GLASS_DEFAULTS };
    return {
      material: GLASS_MATERIALS.includes(value.material) ? value.material : GLASS_DEFAULTS.material,
      theme: ['system', 'light', 'dark'].includes(value.theme) ? value.theme : GLASS_DEFAULTS.theme,
      quality: ['auto', 'optical', 'native', 'safe'].includes(value.quality) ? value.quality : GLASS_DEFAULTS.quality,
      intensity: Number.isFinite(value.intensity) ? Math.max(0, Math.min(100, value.intensity)) : GLASS_DEFAULTS.intensity,
      motion: typeof value.motion === 'boolean' ? value.motion : GLASS_DEFAULTS.motion,
      ambient: typeof value.ambient === 'boolean' ? value.ambient : GLASS_DEFAULTS.ambient,
      cinemaDark: typeof value.cinemaDark === 'boolean' ? value.cinemaDark : GLASS_DEFAULTS.cinemaDark,
      playbackProtection: typeof value.playbackProtection === 'boolean' ? value.playbackProtection : GLASS_DEFAULTS.playbackProtection,
    };
  } catch {
    return { ...GLASS_DEFAULTS };
  }
}

/** Safari uses a transparent native-backdrop material, not an unverified DOM displacement claim. */
export function selectGlassBackend({
  preferences, contrast, transparency, forcedColors, backdrop, webkit, optical,
  playing, underPressure, failed,
}: {
  preferences: GlassPreferences;
  contrast: boolean;
  transparency: boolean;
  forcedColors: boolean;
  backdrop: boolean;
  webkit: boolean;
  optical: boolean;
  playing: boolean;
  underPressure: boolean;
  failed: boolean;
}): GlassBackend {
  if (contrast || transparency || forcedColors || failed || preferences.quality === 'safe' || !backdrop) return 'safe';
  if (underPressure || preferences.quality === 'native' ||
      (playing && preferences.playbackProtection)) return 'native';
  if (webkit) return 'webkit';
  if (!optical) return 'native';
  return 'optical';
}
