export interface TmdbPosterImage {
  file_path?: string | null;
  iso_639_1?: string | null;
}

/**
 * Prefer Chinese-language key art, then language-neutral artwork, and use
 * English-language artwork only as the secondary fallback.
 */
export function selectPreferredTmdbPoster(
  posters: TmdbPosterImage[] | undefined,
  fallbackPath?: string | null,
): string | null | undefined {
  const valid = (posters ?? []).filter(
    (poster): poster is TmdbPosterImage & { file_path: string } =>
      typeof poster.file_path === 'string' && poster.file_path.startsWith('/'),
  );
  const preferred = valid.find((poster) => poster.iso_639_1 === 'zh')
    ?? valid.find((poster) => poster.iso_639_1 == null)
    ?? valid.find((poster) => poster.iso_639_1 === 'en');
  return preferred?.file_path ?? fallbackPath;
}
