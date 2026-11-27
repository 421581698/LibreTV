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

/** Applies environment tokens to one iPad Edition root and returns a complete cleanup function. */
/** Reads the resolved app theme shared by ThemeProvider and Friday Glass. */
export function resolvedIpadAppearance(root: Pick<HTMLElement, 'classList'>): 'light' | 'dark' {
  return root.classList.contains('dark') ? 'dark' : 'light';
}

export function attachEnvironmentEngine(
  root: HTMLElement,
  options: { appearance?: AppearancePreference; backdropLuminance?: () => number | undefined } = {},
): () => void {
  const queries = [
    '(prefers-color-scheme: dark)',
    '(prefers-contrast: more)',
    '(prefers-reduced-transparency: reduce)',
    '(prefers-reduced-motion: reduce)',
  ];
  const media = queries.map((query) => window.matchMedia(query));
  const update = () => {
    // The app's resolved .dark class is the source of truth for every route.
    // Friday's independently persisted glass preference must never override it.
    const systemDark = media[0].matches;
    const resolvedAppearance = resolvedIpadAppearance(document.documentElement);
    const profile = resolveEnvironmentProfile({
      appearance: options.appearance ?? resolvedAppearance,
      systemDark,
      contrast: media[1].matches ? 'more' : 'normal',
      reducedTransparency: media[2].matches,
      reducedMotion: media[3].matches,
      backdropLuminance: options.backdropLuminance?.(),
    });
    root.dataset.environment = profile.colorScheme;
    root.dataset.environmentContrast = profile.contrast;
    root.style.setProperty('--ipad-env-glass-opacity', String(profile.glassOpacity));
    root.style.setProperty('--ipad-env-blur', profile.blurPx + 'px');
    root.style.setProperty('--ipad-env-scrim', String(profile.scrimOpacity));
    root.style.setProperty('--ipad-env-edge-opacity', String(profile.edgeOpacity));
    root.style.colorScheme = profile.colorScheme;
    root.dataset.environmentMotion = profile.motionEnabled ? 'enabled' : 'reduced';
  };
  media.forEach((query) => query.addEventListener('change', update));
  const themeObserver = new MutationObserver(update);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-friday-theme'] });
  update();
  return () => {
    media.forEach((query) => query.removeEventListener('change', update));
    themeObserver.disconnect();
    delete root.dataset.environment;
    delete root.dataset.environmentContrast;
    delete root.dataset.environmentMotion;
    ['--ipad-env-glass-opacity', '--ipad-env-blur', '--ipad-env-scrim', '--ipad-env-edge-opacity']
      .forEach((property) => root.style.removeProperty(property));
    root.style.removeProperty('color-scheme');
  };
}
