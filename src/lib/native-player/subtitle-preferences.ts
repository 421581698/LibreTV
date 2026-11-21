export interface SubtitlePreferences {
  enabled: boolean;
  selectedTrackId: string | null;
  delayMs: number;
  fontSizePercent: number;
  backgroundOpacityPercent: number;
}

export interface SubtitleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_SUBTITLE_PREFERENCES: SubtitlePreferences = {
  enabled: true,
  selectedTrackId: null,
  delayMs: 0,
  fontSizePercent: 100,
  backgroundOpacityPercent: 35,
};

const MAX_DELAY_MS = 10_000;

export function subtitlePreferenceKey(sourceId?: string, episodeId?: string): string {
  const source = encodeURIComponent(sourceId || 'default');
  const episode = encodeURIComponent(episodeId || 'all');
  return `libretv:subtitle-preferences:v1:${source}:${episode}`;
}

export function normalizeSubtitlePreferences(value: unknown): SubtitlePreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SUBTITLE_PREFERENCES };
  const input = value as Partial<SubtitlePreferences>;
  const delayMs = Number(input.delayMs);
  const fontSizePercent = Number(input.fontSizePercent);
  const backgroundOpacityPercent = Number(input.backgroundOpacityPercent);
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_SUBTITLE_PREFERENCES.enabled,
    selectedTrackId: typeof input.selectedTrackId === 'string' && input.selectedTrackId.length <= 256
      ? input.selectedTrackId
      : null,
    delayMs: Number.isFinite(delayMs) ? Math.max(-MAX_DELAY_MS, Math.min(MAX_DELAY_MS, Math.round(delayMs))) : 0,
    fontSizePercent: Number.isFinite(fontSizePercent)
      ? Math.max(60, Math.min(200, Math.round(fontSizePercent)))
      : DEFAULT_SUBTITLE_PREFERENCES.fontSizePercent,
    backgroundOpacityPercent: Number.isFinite(backgroundOpacityPercent)
      ? Math.max(0, Math.min(90, Math.round(backgroundOpacityPercent)))
      : DEFAULT_SUBTITLE_PREFERENCES.backgroundOpacityPercent,
  };
}

export function loadSubtitlePreferences(
  storage: SubtitleStorage,
  sourceId?: string,
  episodeId?: string,
): SubtitlePreferences {
  try {
    const raw = storage.getItem(subtitlePreferenceKey(sourceId, episodeId));
    return raw ? normalizeSubtitlePreferences(JSON.parse(raw)) : { ...DEFAULT_SUBTITLE_PREFERENCES };
  } catch {
    return { ...DEFAULT_SUBTITLE_PREFERENCES };
  }
}

export function saveSubtitlePreferences(
  storage: SubtitleStorage,
  preferences: SubtitlePreferences,
  sourceId?: string,
  episodeId?: string,
): boolean {
  try {
    const normalized = normalizeSubtitlePreferences(preferences);
    storage.setItem(subtitlePreferenceKey(sourceId, episodeId), JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}
