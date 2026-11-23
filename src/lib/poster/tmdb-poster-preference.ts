export interface TmdbPosterImage {
  file_path?: string | null;
  iso_639_1?: string | null;
  width?: number;
  height?: number;
  vote_average?: number;
}

type ArtworkOrientation = 'portrait' | 'landscape';

function selectPreferredArtwork(
  images: TmdbPosterImage[] | undefined,
  fallbackPath: string | null | undefined,
  orientation: ArtworkOrientation,
): string | null | undefined {
  const valid = (images ?? []).filter(
    (image): image is TmdbPosterImage & { file_path: string } => {
      if (typeof image.file_path !== 'string' || !/^\/[^?#\s]+$/.test(image.file_path)) return false;
      if (!image.width || !image.height) return true;
      const ratio = image.width / image.height;
      return orientation === 'portrait' ? ratio <= 1 : ratio > 1;
    },
  );
  const languageRank = (language: string | null | undefined): number => {
    if (language === 'zh') return 0;
    if (language == null) return 1;
    if (language === 'en') return 2;
    return 3;
  };
  const resolutionScore = (image: TmdbPosterImage): number => {
    const width = Number.isFinite(image.width) ? image.width! : 0;
    const height = Number.isFinite(image.height) ? image.height! : 0;
    return width * Math.max(height, 1) + (image.vote_average || 0);
  };
  // Actual pixel area wins over language preference; language only breaks
  // ties so a tiny localized thumbnail never beats a full-resolution image.
  valid.sort((a, b) =>
    resolutionScore(b) - resolutionScore(a)
    || languageRank(a.iso_639_1) - languageRank(b.iso_639_1),
  );
  return valid[0]?.file_path ?? fallbackPath;
}

/** Prefer the largest valid image; language preference breaks equal-resolution ties. */
export function selectPreferredTmdbPoster(
  posters: TmdbPosterImage[] | undefined,
  fallbackPath?: string | null,
): string | null | undefined {
  return selectPreferredArtwork(posters, fallbackPath, 'portrait');
}

/** Backdrops are selected independently and must be landscape artwork. */
export function selectPreferredTmdbBackdrop(
  backdrops: TmdbPosterImage[] | undefined,
  fallbackPath?: string | null,
): string | null | undefined {
  return selectPreferredArtwork(backdrops, fallbackPath, 'landscape');
}
