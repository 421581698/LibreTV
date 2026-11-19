'use client';

import Link from 'next/link';
import type { DoubanItem } from '@/lib/types';
import { fromDoubanItem } from '@/lib/poster';
import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';

interface IpadEditionHeroProps {
  items: DoubanItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

function detailHref(title: string) {
  return '/ipad-edition/detail?title=' + encodeURIComponent(title);
}

/** Homepage-only cinematic feature. Wide artwork is never fabricated from a portrait poster. */
export function IpadEditionHero({ items, activeIndex, onSelect }: IpadEditionHeroProps) {
  const item = items[activeIndex];
  if (!item) return null;

  const hasBackdrop = Boolean(item.backdrop?.trim());
  const posterAsset = fromDoubanItem(item);

  return (
    <section className="ipad-edition__cinema-hero" aria-label="精选影片">
      <div className="ipad-edition__cinema-hero-media" key={item.id || item.title}>
        {hasBackdrop ? (
          <PosterRenderer
            variant="backdrop"
            frameClassName="ipad-edition__cinema-hero-backdrop"
            url={item.backdrop}
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
              frameClassName="ipad-edition__cinema-hero-poster"
              asset={posterAsset}
              url={item.cover}
              mode="proxy"
              alt=""
              loading="eager"
            />
          </>
        )}
      </div>

      <div className="ipad-edition__cinema-hero-shade" />
      <div className="ipad-edition__cinema-hero-copy">
        <p className="ipad-edition__cinema-hero-kicker">LIBRETV · 精选推荐</p>
        <h1>{item.title}</h1>
        <div className="ipad-edition__cinema-hero-meta">
          <span>豆瓣热门</span>
          {item.rating ? <span className="ipad-edition__cinema-hero-rating">★ {item.rating}</span> : null}
        </div>
        <Link className="ipad-edition__cinema-hero-cta" href={detailHref(item.title)}>
          查看影片详情
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      {items.length > 1 ? (
        <div className="ipad-edition__cinema-hero-pagination" role="group" aria-label="切换精选影片">
          <span className="ipad-edition__cinema-hero-count">
            {String(activeIndex + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
          </span>
          {items.map((candidate, index) => (
            <button
              key={candidate.id || candidate.title}
              type="button"
              aria-label={'精选：' + candidate.title}
              aria-pressed={activeIndex === index}
              className={activeIndex === index ? 'is-active' : ''}
              onClick={() => onSelect(index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
