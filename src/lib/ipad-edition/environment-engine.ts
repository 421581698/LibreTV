export type AppearancePreference = 'light' | 'dark' | 'system';
export type ContrastPreference = 'normal' | 'more';
export type EnvironmentSignals = {
  appearance: AppearancePreference;
  systemDark: boolean;
  contrast: ContrastPreference;
  reducedTransparency: boolean;
  reducedMotion: boolean;
  /** Normalized luminance of the content behind the glass, when the host can measure it. */
  backdropLuminance?: number;
  /** Optional lux reading from an explicitly supported sensor; Safari availability is not assumed. */
  ambientLux?: number | null;
};
export type EnvironmentProfile = {
  colorScheme: 'light' | 'dark';
  contrast: 'normal' | 'high';
  glassOpacity: number;
  blurPx: number;
  scrimOpacity: number;
  edgeOpacity: number;
  motionEnabled: boolean;
  ambientClass: 'bright' | 'balanced' | 'dim' | 'unknown';
};
function clampUnit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}
/** Resolves shared glass tokens from OS preferences and measured host context. */
export function resolveEnvironmentProfile(signals: EnvironmentSignals): EnvironmentProfile {
  const colorScheme = signals.appearance === 'system' ? (signals.systemDark ? 'dark' : 'light') : signals.appearance;
  const backdrop = clampUnit(signals.backdropLuminance, colorScheme === 'dark' ? 0.12 : 0.82);
  const lux = signals.ambientLux;
  const ambientClass = typeof lux === 'number' && Number.isFinite(lux)
    ? lux < 30 ? 'dim' : lux > 800 ? 'bright' : 'balanced'
    : 'unknown';
  const highContrast = signals.contrast === 'more' || signals.reducedTransparency;
  const scrimOpacity = highContrast ? 0.34 : backdrop > 0.62
    ? (colorScheme === 'dark' ? 0.3 : 0.16)
    : backdrop < 0.28 ? (colorScheme === 'light' ? 0.28 : 0.12) : 0.2;
  return {
    colorScheme,
    contrast: highContrast ? 'high' : 'normal',
    glassOpacity: signals.reducedTransparency ? 0.94 : colorScheme === 'dark' ? 0.72 : 0.68,
    blurPx: signals.reducedTransparency ? 0 : colorScheme === 'dark' ? 28 : 24,
    scrimOpacity,
    edgeOpacity: highContrast ? 0.34 : colorScheme === 'dark' ? 0.2 : 0.24,
    motionEnabled: !signals.reducedMotion,
    ambientClass,
  };
}
