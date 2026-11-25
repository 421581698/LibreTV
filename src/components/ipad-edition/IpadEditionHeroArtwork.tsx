'use client';

import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { fromTmdbItem } from '@/lib/poster';
import type { DoubanItem } from '@/lib/types';

interface IpadEditionHeroArtworkProps {
  item: DoubanItem;
}

/**
 * A real TMDB backdrop is the sole foreground hero artwork.
 * A portrait poster is never layered over a landscape backdrop.
 * When no backdrop exists, use a blurred full-bleed poster atmosphere with
 * the original portrait poster contained at its native aspect ratio.
 */
export function IpadEditionHeroArtwork({ item }: IpadEditionHeroArtworkProps) {
  const backdrop = item.backdrop?.trim();
  const posterAsset = fromTmdbItem(item);

  return (
    <div
      className="ipad-edition__cinema-hero-media"
      data-artwork-mode={backdrop ? 'landscape-backdrop' : 'portrait-poster-fallback'}
      data-backdrop-present={backdrop ? 'true' : 'false'}
    >
      {backdrop ? (
        <PosterRenderer
          variant="backdrop"
          frameClassName="ipad-edition__cinema-hero-backdrop"
          url={backdrop}
          fallbackUrl={item.cover}
          mode="proxy"
          alt=""
          loading="eager"
        />
      ) : (
        <>
          <PosterRenderer
            variant="backdrop"
            frameClassName="ipad-edition__cinema-hero-atmosphere"
            asset={posterAsset}
            url={item.cover}
            mode="proxy"
            alt=""
            loading="eager"
          />
          <PosterRenderer
            variant="hero-poster"
            frameClassName="ipad-edition__cinema-hero-fallback-poster"
            asset={posterAsset}
            url={item.cover}
            mode="proxy"
            alt={item.title + ' 海报'}
            loading="eager"
            measureNaturalSize
          />
        </>
      )}
    </div>
  );
}
