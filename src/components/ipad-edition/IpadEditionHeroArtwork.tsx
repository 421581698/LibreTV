'use client';

import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { fromDoubanItem } from '@/lib/poster';
import type { DoubanItem } from '@/lib/types';

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
  const posterAsset = fromDoubanItem(item);

  return (
    <div
      className="ipad-edition__cinema-hero-media"
      data-artwork-mode={backdrop ? 'backdrop-with-poster' : 'poster-fallback'}
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
        asset={posterAsset}
        url={item.cover}
        mode="proxy"
        alt={item.title + ' 海报'}
        loading="eager"
      />
    </div>
  );
}
