/** Original image bytes preserve ICC, wide gamut, and embedded gain maps where supported. */
export type CinemaLogoAsset = {
  file_path?: string | null;
  iso_639_1?: string | null;
  width?: number;
  height?: number;
  vote_average?: number;
};

/** An oversized or ultra-wide canvas should not obscure the underlying film artwork. */
export function selectCinemaTitleLogo(logos: readonly CinemaLogoAsset[] | undefined): string | undefined {
  const languageRank = (language: string | null | undefined) => language === 'zh' ? 0 : language === 'en' ? 1 : 2;
  return (logos ?? [])
    .filter((item) => {
      const width = item.width ?? 0;
      const height = item.height ?? 0;
      const aspect = width / height;
      return typeof item.file_path === 'string'
        && /^\/[A-Za-z0-9_-]+\.png$/i.test(item.file_path)
        && Number.isFinite(width) && Number.isFinite(height)
        && width >= 180 && height >= 32
        && aspect >= 0.65 && aspect <= 4.5
        && (item.iso_639_1 === 'zh' || item.iso_639_1 === 'en' || item.iso_639_1 == null);
    })
    .sort((a, b) => languageRank(a.iso_639_1) - languageRank(b.iso_639_1)
      || (b.vote_average ?? 0) - (a.vote_average ?? 0)
      || (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0]?.file_path ?? undefined;
}

/** Only opt-in iPad media should bypass a proxy first; custom proxy choice is preserved.
 * This does not establish that an image is HDR or that the screen rendered HDR.
 */
export function preferOriginalCinemaImage(
  candidates: readonly string[],
  original: string | undefined,
  mode: 'direct' | 'proxy' | 'custom',
  enabled: boolean,
): string[] {
  if (!enabled || mode !== 'proxy' || !original || !/^https:\/\/[^\s]+$/i.test(original)) return [...candidates];
  return [...new Set([original, ...candidates])];
}
