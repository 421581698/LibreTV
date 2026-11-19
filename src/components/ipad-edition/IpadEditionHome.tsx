'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SmartImage } from '@/components/smart-image';
import { api } from '@/lib/client-api';
import { fetchHomepageWithFallback } from '@/lib/homepage-recommendation-fallback';
import { useAppStore } from '@/lib/store';
import type { DoubanItem } from '@/lib/types';
import { fromBangumiItem, fromDoubanItem } from '@/lib/poster';
import { IpadEditionContinueWatching } from '@/components/ipad-edition/IpadEditionContinueWatching';

const RAIL_SIZE = 10;
const HERO_SIZE = 5;

function searchHref(title: string) {
  return '/ipad-edition/search?q=' + encodeURIComponent(title);
}

function detailHref(title: string) {
  return '/ipad-edition/detail?title=' + encodeURIComponent(title);
}

export function IpadEditionHome() {
  const [activeHero, setActiveHero] = useState(0);
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);

  // One real recommendation request feeds both the featured hero and today's movie rail.
  // This avoids duplicate requests and keeps the hero and poster rail consistent.
  // Homepage posters use the built-in same-origin image proxy first. The public Douban mirrors
  // intermittently stall on iPad-sized poster rails; proxy responses carry a long browser cache.
  const featured = useQuery({
    queryKey: ['ipad-edition-home-featured', doubanEnabled],
    queryFn: ({ signal }) => fetchHomepageWithFallback(
      () => api.douban('movie', '热门', 0, RAIL_SIZE, signal),
      () => api.hotList('douban_movie_weekly', signal),
      signal,
    ),
    enabled: doubanEnabled,
    staleTime: 5 * 60_000,
  });

  const series = useQuery({
    queryKey: ['ipad-edition-series'],
    queryFn: ({ signal }) => fetchHomepageWithFallback(
      () => api.douban('tv', '热门', 0, RAIL_SIZE, signal),
      () => api.hotList('douban_tv_chinese', signal),
      signal,
    ),
    enabled: doubanEnabled,
    staleTime: 5 * 60_000,
  });

  const newReleases = useQuery({
    queryKey: ['ipad-edition-new'],
    queryFn: ({ signal }) => api.douban('movie', '最新', 0, RAIL_SIZE, signal),
    enabled: doubanEnabled,
    staleTime: 5 * 60_000,
  });

  const calendar = useQuery({
    queryKey: ['ipad-edition-bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
    staleTime: 30 * 60_000,
  });

  const movieItems = useMemo(() => {
    const seen = new Set<string>();
    return (featured.data?.items ?? []).filter((item) => {
      const key = item.id || item.title;
      if (!item.title?.trim() || !item.cover?.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [featured.data]);

  const heroItems = movieItems.slice(0, HERO_SIZE);
  const hero = heroItems.length ? heroItems[activeHero % heroItems.length] : undefined;
  const today = ((new Date().getDay() + 6) % 7) + 1;
  const todayItems = calendar.data?.days.find((day) => day.weekday === today)?.items ?? [];

  const renderRail = (
    id: string,
    title: string,
    items: DoubanItem[],
    loading: boolean,
    error: boolean,
  ) => (
    <section className="ipad-edition__rail-section" id={id} aria-labelledby={id + '-title'}>
      <div className="ipad-edition__section-heading">
        <h2 id={id + '-title'}>{title}</h2>
      </div>
      {loading ? (
        <div className="ipad-edition__poster-grid" aria-label={title + '加载中'} aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="ipad-edition__poster-skeleton" key={index} />
          ))}
        </div>
      ) : error ? (
        <div className="ipad-edition__rail-message" role="status">
          暂时无法获取{title}，请稍后重试。
        </div>
      ) : items.length ? (
        <div className="ipad-edition__poster-grid" aria-label={title}>
          {items.slice(0, RAIL_SIZE).map((item, index) => (
            <Link className="ipad-edition__poster-card" data-ipad-poster-slot={id === 'ipad-popular-series' ? 'series' : id === 'ipad-new-releases' ? 'new-release' : 'movie'} data-poster-url={item.cover ?? ''} href={searchHref(item.title)} key={item.id || item.title}>
              <span className="ipad-edition__poster-art">
                <SmartImage
                  asset={fromDoubanItem(item)}
                  url={item.cover}
                  mode="proxy"
                  alt={item.title}
                  loading="lazy"
                />
                <span className="ipad-edition__poster-rank">{index + 1}</span>
              </span>
              <strong title={item.title}>{item.title}</strong>
              <small>{item.rating ? '★ ' + item.rating : '影视推荐'}</small>
            </Link>
          ))}
        </div>
      ) : (
        <div className="ipad-edition__rail-message">当前没有可展示的真实内容。</div>
      )}
    </section>
  );

  return (
    <div className="ipad-edition__home">
      <section className="ipad-edition__hero" aria-label="精选影片">
        {hero ? (
          <>
            <div className="ipad-edition__hero-backdrop" aria-hidden="true">
              <SmartImage
                url={hero.backdrop || hero.cover}
                mode="proxy"
                alt=""
                loading="eager"
              />
            </div>
            <div className="ipad-edition__hero-art">
              <SmartImage
                asset={fromDoubanItem(hero)}
                url={hero.cover}
                mode="proxy"
                alt=""
                loading="eager"
              />
            </div>
            <div className="ipad-edition__hero-veil" />
            <div className="ipad-edition__hero-copy">
              <h1>{hero.title}</h1>
              <p>在大银幕般的画面里，发现下一部值得收藏的作品。</p>
              <div className="ipad-edition__hero-meta">
                <span>豆瓣热门精选</span>
                {hero.rating ? <span>★ {hero.rating}</span> : null}
              </div>
              <div className="ipad-edition__hero-actions">
                <Link className="ipad-edition__hero-cta" href={detailHref(hero.title)}>
                  播放影片
                  <svg className="ipad-edition__play-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M5 3.5 12 8l-7 4.5z" fill="currentColor" />
                  </svg>
                </Link>
                <Link className="ipad-edition__hero-add" href={detailHref(hero.title)} aria-label="查看影片详情">＋</Link>
              </div>
            </div>
            {heroItems.length > 1 ? (
              <div className="ipad-edition__hero-dots" role="group" aria-label="切换精选影片">
                {heroItems.map((item, index) => (
                  <button
                    key={item.id || item.title}
                    type="button"
                    aria-label={'精选：' + item.title}
                    aria-pressed={activeHero === index}
                    className={activeHero === index ? 'is-active' : ''}
                    onClick={() => setActiveHero(index)}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="ipad-edition__hero-copy" role="status">
            <p className="ipad-edition__eyebrow">影院大堂 · LIBRETV IPAD EDITION</p>
            <h1>{featured.isLoading ? '正在为你准备影院' : '精选内容暂不可用'}</h1>
            <p>{featured.isLoading ? '正在获取真实影视推荐…' : '推荐服务暂时不可用，请稍后重试。'}</p>
            {featured.isError ? (
              <button type="button" onClick={() => void featured.refetch()}>重新加载</button>
            ) : null}
          </div>
        )}
      </section>

      {renderRail('ipad-popular-movies', '今日热门', movieItems, featured.isLoading, featured.isError)}

      <IpadEditionContinueWatching />

      {renderRail('ipad-popular-series', '热门剧集', series.data?.items ?? [], series.isLoading, series.isError)}
      {renderRail('ipad-new-releases', '新近上线', newReleases.data?.items ?? [], newReleases.isLoading, newReleases.isError)}

      <section className="ipad-edition__rail-section" id="ipad-anime-calendar" aria-labelledby="ipad-anime-title">
        <div className="ipad-edition__section-heading">
          <h2 id="ipad-anime-title">今日新番</h2>
        </div>
        {calendar.isLoading ? (
          <div className="ipad-edition__rail-message" role="status">正在读取每日放送…</div>
        ) : calendar.isError ? (
          <div className="ipad-edition__rail-message" role="status">新番日历暂时不可用。</div>
        ) : todayItems.length ? (
          <div className="ipad-edition__anime-grid">
            {todayItems.slice(0, 5).map((item) => (
              <Link href={searchHref(item.title)} className="ipad-edition__anime-card" data-ipad-poster-slot="anime" data-poster-url={item.cover ?? ''} key={item.id}>
                <span>
                  <SmartImage
                    asset={fromBangumiItem(item)}
                    url={item.cover}
                    mode="proxy"
                      alt={item.title}
                    loading="lazy"
                  />
                </span>
                <strong>{item.title}</strong>
                {item.rating ? <small>★ {item.rating}</small> : null}
              </Link>
            ))}
          </div>
        ) : (
          <div className="ipad-edition__rail-message">今天暂无可展示的新番条目。</div>
        )}
      </section>
    </div>
  );
}
