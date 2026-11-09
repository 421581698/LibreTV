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
    <section className="v4-hero" aria-label="精选影片">
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
          <div className="v4-hero-content">
            <span className="v4-hero-eyebrow">LIBRETV · FEATURED</span>
            <h1>{slide.title}</h1>
            <p>{slide.rating ? `豆瓣评分 ${slide.rating} · 精选推荐` : '来自实时影视推荐的精选内容'}</p>
            <div className="v4-hero-actions">
              <button type="button" className="v4-hero-primary" onClick={() => onPick(slide)}>
                <span aria-hidden="true">▶</span>
                查看播放资源
              </button>
              <a className="v4-hero-secondary" href="#today-recommendations">浏览全部推荐</a>
            </div>
          </div>
          <div className="v4-hero-indicators" role="group" aria-label="选择精选影片">
            {slides.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={`查看精选影片：${item.title}`}
                aria-pressed={normalizedActiveSlide === index}
                className={activeSlide === index ? 'is-active' : ''}
                onClick={() => setActiveSlide(index)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="v4-hero-content v4-hero-empty" role="status">
          <span className="v4-hero-eyebrow">LIBRETV · FEATURED</span>
          <h1>{featuredQuery.isLoading ? '正在载入精选内容' : '精选内容暂不可用'}</h1>
          <p>{featuredQuery.isError ? '推荐接口暂时没有响应，请稍后重试。' : '连接真实推荐数据后，这里会展示可查找播放资源的影片。'}</p>
          <div className="v4-hero-actions">
            <a className="v4-hero-primary" href="#today-recommendations">浏览今日推荐</a>
            {featuredQuery.isError && (
              <button type="button" className="v4-hero-secondary" onClick={() => void featuredQuery.refetch()}>
                重试加载
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
