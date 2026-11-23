'use client';

import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react';
import type { DoubanItem } from '@/lib/types';
import { IpadEditionHeroArtwork } from '@/components/ipad-edition/IpadEditionHeroArtwork';

interface IpadEditionHeroProps {
  items: DoubanItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onOpen: (item: DoubanItem) => void;
  pendingTitle: string;
}

/** Homepage-only cinematic feature; source artwork is navigable by swipe, keys and controls. */
export function IpadEditionHero({ items, activeIndex, onSelect, onOpen, pendingTitle }: IpadEditionHeroProps) {
  const item = items[activeIndex];
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  if (!item) return null;

  const selectRelative = (direction: -1 | 1) => {
    onSelect((activeIndex + direction + items.length) % items.length);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || event.pointerType === 'mouse') return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    selectRelative(deltaX < 0 ? 1 : -1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectRelative(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectRelative(1);
    }
  };

  return (
    <section
      className="ipad-edition__cinema-hero"
      aria-label="精选影片"
      aria-roledescription="电影精选轮播"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStart.current = null; }}
      onKeyDown={handleKeyDown}
    >
      <IpadEditionHeroArtwork item={item} key={item.id || item.title} />
      <div className="ipad-edition__cinema-hero-shade" aria-hidden="true" />
      <div className="ipad-edition__cinema-hero-copy" key={item.id || item.title} aria-live="polite">
        <p className="ipad-edition__cinema-hero-kicker">LIBRETV · 精选推荐</p>
        <h1>{item.title}</h1>
        <div className="ipad-edition__cinema-hero-actions">
          <button type="button" className="ipad-edition__cinema-hero-cta" aria-busy={pendingTitle === item.title} disabled={Boolean(pendingTitle)} onClick={() => onOpen(item)}>
            <span aria-hidden="true">▶</span>
            查看详情
          </button>
          <button type="button" className="ipad-edition__cinema-hero-more" aria-label={'查看 ' + item.title + ' 的更多信息'} disabled={Boolean(pendingTitle)} onClick={() => onOpen(item)}>
            <span aria-hidden="true">＋</span>
          </button>
        </div>
      </div>

      {items.length > 1 ? (
        <div className="ipad-edition__cinema-hero-pagination" role="group" aria-label="切换精选影片">
          <button className="sr-only" type="button" aria-label="上一部精选影片" onClick={() => selectRelative(-1)} />
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
          <button className="sr-only" type="button" aria-label="下一部精选影片" onClick={() => selectRelative(1)} />
        </div>
      ) : null}
    </section>
  );
}
