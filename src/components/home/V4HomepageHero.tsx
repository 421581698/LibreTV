'use client';

import { useState } from 'react';

const slides = [
  {
    title: '星际穿越',
    subtitle: '穿越虫洞，寻找人类的未来',
    image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=2400&q=88',
    alt: '深邃宇宙与地球地平线',
  },
  {
    title: '深空探索',
    subtitle: '在未知的边界，寻找新的答案',
    image: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=2400&q=88',
    alt: '星云与深空',
  },
  {
    title: '星际旅程',
    subtitle: '每一次远行，都是新的开始',
    image: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=2400&q=88',
    alt: '从太空俯瞰地球',
  },
];

export function V4HomepageHero() {
  const [activeSlide, setActiveSlide] = useState(0);
  const slide = slides[activeSlide];

  return (
    <section className="v4-hero" aria-label="精选影片轮播">
      <div
        className="v4-hero-image"
        role="img"
        aria-label={slide.alt}
        style={{ backgroundImage: `linear-gradient(90deg, rgba(4, 9, 18, .78) 0%, rgba(4, 9, 18, .38) 43%, rgba(4, 9, 18, .04) 100%), linear-gradient(0deg, rgba(4, 9, 18, .28), transparent 42%), url("${slide.image}")` }}
      />
      <div className="v4-hero-content">
        <span className="v4-hero-eyebrow">LIBRETV · FEATURED</span>
        <h1>{slide.title}</h1>
        <p>{slide.subtitle}</p>
        <div className="v4-hero-actions">
          <a className="v4-hero-primary" href="#today-recommendations">
            <span aria-hidden="true">▶</span>
            立即播放
          </a>
          <a className="v4-hero-secondary" href="#today-recommendations">更多详情</a>
        </div>
      </div>
      <div className="v4-hero-indicators" role="tablist" aria-label="选择 Banner">
        {slides.map((item, index) => (
          <button
            key={item.title}
            type="button"
            role="tab"
            aria-label={`第 ${index + 1} 张`}
            aria-selected={activeSlide === index}
            className={activeSlide === index ? 'is-active' : ''}
            onClick={() => setActiveSlide(index)}
          />
        ))}
      </div>
    </section>
  );
}
