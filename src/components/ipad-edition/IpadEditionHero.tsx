'use client';

import Link from 'next/link';
import type { DoubanItem } from '@/lib/types';
import { IpadEditionHeroArtwork } from '@/components/ipad-edition/IpadEditionHeroArtwork';

interface IpadEditionHeroProps {
  items: DoubanItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

function detailHref(title: string) {
  return '/ipad-edition/detail?title=' + encodeURIComponent(title);
}

/** Homepage-only cinematic feature; content and artwork remain source-backed. */
export function IpadEditionHero({ items, activeIndex, onSelect }: IpadEditionHeroProps) {
  const item = items[activeIndex];
  if (!item) return null;

  return (
    <section className="ipad-edition__cinema-hero" aria-label="精选影片">
      <IpadEditionHeroArtwork item={item} key={item.id || item.title} />
      <div className="ipad-edition__cinema-hero-shade" aria-hidden="true" />
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
