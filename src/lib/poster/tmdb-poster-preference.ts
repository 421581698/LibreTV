export interface TmdbPosterImage {
  file_path?: string | null;
  iso_639_1?: string | null;
  width?: number;
  height?: number;
  vote_average?: number;
}

/**
 * Select the sharpest usable poster within the preferred language tier.
 * Language remains a preference, but resolution breaks ties so a small
 * localized thumbnail cannot beat a much larger image of the same language.
 */
export function selectPreferredTmdbPoster(
  posters: TmdbPosterImage[] | undefined,
  fallbackPath?: string | null,
): string | null | undefined {
  const valid = (posters ?? []).filter(
    (poster): poster is TmdbPosterImage & { file_path: string } =>
      typeof poster.file_path === 'string' && /^\\/[^?#\\s]+$/.test(poster.file_path),
  );
  const languageRank = (language: string | null | undefined): number => {
    if (language === 'zh') return 0;
    if (language == null) return 1;
    if (language === 'en') return 2;
    return 3;
  };
  const qualityScore = (poster: TmdbPosterImage): number => {
    const width = Number.isFinite(poster.width) ? poster.width! : 0;
    const height = Number.isFinite(poster.height) ? poster.height! : 0;
    const ratio = height > 0 ? width / height : 0;
    // Penalize non-poster geometry; TMDB poster images should be portrait.
    const ratioPenalty = ratio > 0 && ratio < 0.9 ? 0 : ratio >= 0.9 ? 1_000_000 : 0;
    return ratioPenalty + width * Math.max(height, 1) + (poster.vote_average || 0);
  };
  valid.sort((a, b) =>
    languageRank(a.iso_639_1) - languageRank(b.iso_639_1)
    || qualityScore(b) - qualityScore(a),
  );
  return valid[0]?.file_path ?? fallbackPath;
}
