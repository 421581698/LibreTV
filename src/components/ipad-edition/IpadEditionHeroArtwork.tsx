'use client';

import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { fromTmdbItem } from '@/lib/poster';
import type { DoubanItem } from '@/lib/types';

function getHighResolutionTmdbPosterUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.hostname !== 'image.tmdb.org') return value;
    const match = url.pathname.match(/^(\/t\/p\/)(?:w[0-9]+|original)(\/.+)$/);
    if (!match) return value;
    url.pathname = match[1] + 'w1280' + match[2];
    return url.toString();
  } catch {
    return value;
  }
}

interface IpadEditionHeroArtworkProps {
  item: DoubanItem;
}

/**
 * Keep the source backdrop as the cinematic scene when available, while always
 * presenting the matching portrait poster as the foreground artwork.
 * No generated or substituted artwork is introduced.
 */
export function IpadEditionHeroArtwork({ item }: IpadEditionHeroArtworkProps) {
  const backdrop = item.backdrop?.trim();
  const posterAsset = fromTmdbItem(item);
  const highResolutionPosterUrl = getHighResolutionTmdbPosterUrl(item.cover);
  const heroPosterAsset = posterAsset && highResolutionPosterUrl
    ? { ...posterAsset, originalUrl: highResolutionPosterUrl }
    : posterAsset;

  return (
    <div
      className="ipad-edition__cinema-hero-media"
      data-artwork-mode={backdrop ? 'backdrop-with-poster' : 'poster-fallback'}
      data-poster-resolution-target="1200"
      data-poster-resolution-audit="natural-width"
    >
      {backdrop ? (
        <PosterRenderer
          variant="backdrop"
          frameClassName="ipad-edition__cinema-hero-backdrop"
          url={backdrop}
          fallbackUrl={undefined}
          mode="proxy"
          alt=""
          loading="eager"
        />
      ) : (
        <PosterRenderer
          variant="backdrop"
          frameClassName="ipad-edition__cinema-hero-atmosphere"
          asset={posterAsset}
          url={item.cover}
          mode="proxy"
          alt=""
          loading="eager"
        />
      )}

      <PosterRenderer
        variant="hero-poster"
        frameClassName="ipad-edition__cinema-hero-poster"
        asset={heroPosterAsset}
        url={highResolutionPosterUrl ?? item.cover}
        fallbackUrl={item.cover}
        mode="proxy"
        alt={item.title + ' 海报'}
        loading="eager"
        measureNaturalSize
      />
    </div>
  );
}
