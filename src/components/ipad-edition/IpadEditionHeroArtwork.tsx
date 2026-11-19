'use client';

import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { fromDoubanItem } from '@/lib/poster';
import type { DoubanItem } from '@/lib/types';

interface IpadEditionHeroArtworkProps {
  item: DoubanItem;
}

/**
 * Selects only artwork actually supplied by the recommendation source.
 * A portrait cover is never stretched into a fabricated cinematic still.
 */
export function IpadEditionHeroArtwork({ item }: IpadEditionHeroArtworkProps) {
  const backdrop = item.backdrop?.trim();
  const posterAsset = fromDoubanItem(item);

  if (backdrop) {
    return (
      <div className="ipad-edition__cinema-hero-media" data-artwork-mode="backdrop">
        <PosterRenderer
          variant="backdrop"
          frameClassName="ipad-edition__cinema-hero-backdrop"
          url={backdrop}
          fallbackUrl={undefined}
          mode="proxy"
          alt=""
          loading="eager"
        />
      </div>
    );
  }

  return (
    <div className="ipad-edition__cinema-hero-media" data-artwork-mode="poster-fallback">
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
