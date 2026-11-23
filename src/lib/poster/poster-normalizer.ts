import type { PosterAspectClass, PosterAsset, PosterImageKind } from './poster-types';

export function classifyPosterAspect(width?: number, height?: number): PosterAspectClass {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height || width <= 0 || height <= 0) {
    return 'unknown';
  }
  const ratio = width / height;
  if (ratio < 0.82) return 'portrait';
  if (ratio > 1.22) return 'landscape';
  return 'square';
}

/** Attach measured dimensions without modifying the original asset URL. */
export function withPosterDimensions(
  asset: PosterAsset,
  width: number,
  height: number,
): PosterAsset {
  const valid = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  if (!valid) return asset;
  return {
    ...asset,
    width,
    height,
    aspectRatio: width / height,
    aspectClass: classifyPosterAspect(width, height),
  };
}

export function inferPosterImageKind(width?: number, height?: number): PosterImageKind {
  const aspect = classifyPosterAspect(width, height);
  if (aspect === 'portrait') return 'poster';
  if (aspect === 'landscape') return 'backdrop';
  return 'unknown';
}
