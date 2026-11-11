'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { SmartImage } from '@/components/smart-image';
import { useAppStore } from '@/lib/store';
import type { DoubanItem } from '@/lib/types';

export function V4HomepageHero({ onPick }: { onPick: (item: DoubanItem) => void }) {
  const [activeSlide, setActiveSlide] = useState(0);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const featuredQuery = useQuery({
    queryKey: ['v4-featured-movies'],
    queryFn: ({ signal }) => api.douban('movie', '热门', 0, 8, signal),
    staleTime: 5 * 60_000,
  });
  const slides = (featuredQuery.data?.items ?? []).filter((item) => item.cover).slice(0, 5);
  const normalizedActiveSlide = slides.length > 0 ? activeSlide % slides.length : 0;
  const slide = slides[normalizedActiveSlide];

  return (
    <section className="v4-hero v4-hero-immersive" aria-label="精选影片">
      {slide ? (
        <>
          <div className="v4-hero-image" aria-hidden="true">
            <SmartImage
              url={slide.cover}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
          <div className="v4-hero-veil" aria-hidden="true" />
          <div className="v4-hero-content v4-hero-immersive-copy">
            <h1>发现好内容</h1>
            <p className="v4-hero-subtitle">从热门影片中，找到下一部值得看的作品</p>
            <div className="v4-hero-tags" aria-label="内容标签">
              <span>精选影片</span>
              <span>豆瓣热门</span>
              {slide.rating ? <span>★ {slide.rating}</span> : null}
            </div>
            <div className="v4-hero-actions v4-apple-actions">
              <button type="button" className="v4-hero-primary" aria-label={`播放精选影片：${slide.title}`} onClick={() => onPick(slide)}>
                立即播放
              </button>
              <span className="v4-hero-plus" aria-hidden="true">+</span>
            </div>
            <span className="v4-hero-featured-title">本期精选 · {slide.title}</span>
          </div>
          <div className="v4-hero-indicators v4-hero-dots" role="group" aria-label="选择 Banner 图片">
            {slides.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={`查看精选影片：${item.title}`}
                aria-pressed={normalizedActiveSlide === index}
                className={normalizedActiveSlide === index ? 'is-active' : ''}
                onClick={() => setActiveSlide(index)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="v4-hero-content v4-hero-empty v4-hero-immersive-copy" role="status">
          <span className="v4-hero-eyebrow">LIBRETV</span>
          <h1>{featuredQuery.isLoading ? '发现好内容' : '精选内容暂不可用'}</h1>
          <p>{featuredQuery.isLoading ? '正在为你挑选精彩影片' : '推荐内容暂时无法加载，请稍后再试'}</p>
          {!featuredQuery.isLoading && (
            <button
              type="button"
              className="v4-hero-retry"
              onClick={() => void featuredQuery.refetch()}
              disabled={featuredQuery.isFetching}
            >
              {featuredQuery.isFetching ? '正在重试…' : '重试加载'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
