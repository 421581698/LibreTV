'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SmartImage } from '@/components/smart-image';
import { api } from '@/lib/client-api';
import { fetchHomepageWithFallback } from '@/lib/homepage-recommendation-fallback';
import { useAppStore } from '@/lib/store';
import type { DoubanItem } from '@/lib/types';
import { IpadEditionContinueWatching } from '@/components/ipad-edition/IpadEditionContinueWatching';

const RAIL_SIZE = 10;

function searchHref(title: string) {
  return '/ipad-edition/search?q=' + encodeURIComponent(title);
}

export function IpadEditionHome() {
  const [activeHero, setActiveHero] = useState(0);
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);

  const featured = useQuery({
    queryKey: ['ipad-edition-featured'],
    queryFn: ({ signal }) => fetchHomepageWithFallback(
      () => api.douban('movie', '热门', 0, 8, signal),
      () => api.hotList('douban_movie_weekly', signal),
      signal,
    ),
    staleTime: 5 * 60_000,
  });
  const movies = useQuery({
    queryKey: ['ipad-edition-movies'],
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

  const featuredItems = useMemo(
    () => (featured.data?.items ?? []).filter((item) => item.cover).slice(0, 5),
    [featured.data],
  );
  const hero = featuredItems.length ? featuredItems[activeHero % featuredItems.length] : undefined;
  const today = ((new Date().getDay() + 6) % 7) + 1;
  const todayItems = calendar.data?.days.find((day) => day.weekday === today)?.items ?? [];

  const renderRail = (id: string, title: string, items: DoubanItem[], loading: boolean, error: boolean) => (
    <section className="ipad-edition__rail-section" id={id} aria-labelledby={id + '-title'}>
      <div className="ipad-edition__section-heading">
        <div><p className="ipad-edition__eyebrow">CURATED FOR YOU</p><h2 id={id + '-title'}>{title}</h2></div>
        <Link href={searchHref(title)}>探索更多 <span aria-hidden="true">›</span></Link>
      </div>
      {loading ? (
        <div className="ipad-edition__poster-grid" aria-label={title + '加载中'}>
          {Array.from({ length: 5 }).map((_, index) => <div className="ipad-edition__poster-skeleton" key={index} />)}
        </div>
      ) : error ? (
        <div className="ipad-edition__rail-message" role="status">暂时无法获取{title}，请稍后重试。</div>
      ) : items.length ? (
        <div className="ipad-edition__poster-grid">
          {items.slice(0, 5).map((item, index) => (
            <Link className="ipad-edition__poster-card" href={searchHref(item.title)} key={item.id}>
              <span className="ipad-edition__poster-art">
                <SmartImage url={item.cover} mode={imageProxyMode} customProxy={customImageProxy} alt={item.title} />
                <span className="ipad-edition__poster-rank">{index + 1}</span>
              </span>
              <strong title={item.title}>{item.title}</strong>
              {item.rating ? <small>★ {item.rating}</small> : <small>影视推荐</small>}
            </Link>
          ))}
        </div>
      ) : <div className="ipad-edition__rail-message">当前没有可展示的真实内容。</div>}
    </section>
  );

  return (
    <div className="ipad-edition__home">
      <section className="ipad-edition__hero" aria-label="精选影片">
        {hero ? (
          <>
            <div className="ipad-edition__hero-art">
              <SmartImage url={hero.cover} mode={imageProxyMode} customProxy={customImageProxy} alt="" loading="eager" />
            </div>
            <div className="ipad-edition__hero-veil" />
            <div className="ipad-edition__hero-copy">
              <p className="ipad-edition__eyebrow">影院大堂 · LIBRETV ORIGINAL SELECTION</p>
              <h1>{hero.title}</h1>
              <p>在大银幕般的画面里，发现下一部值得收藏的作品。</p>
              <div className="ipad-edition__hero-meta"><span>豆瓣热门精选</span>{hero.rating ? <span>★ {hero.rating}</span> : null}</div>
              <Link className="ipad-edition__hero-cta" href={searchHref(hero.title)}>查看影片 <span aria-hidden="true">↗</span></Link>
            </div>
            {featuredItems.length > 1 ? (
              <div className="ipad-edition__hero-dots" role="group" aria-label="切换精选影片">
                {featuredItems.map((item, index) => <button key={item.id} type="button" aria-label={'精选：' + item.title} aria-pressed={activeHero === index} className={activeHero === index ? 'is-active' : ''} onClick={() => setActiveHero(index)} />)}
              </div>
            ) : null}
          </>
        ) : (
          <div className="ipad-edition__hero-copy" role="status">
            <p className="ipad-edition__eyebrow">影院大堂 · LIBRETV IPAD EDITION</p>
            <h1>{featured.isLoading ? '正在为你准备影院' : '精选内容暂不可用'}</h1>
            <p>{featured.isLoading ? '正在获取真实影视推荐…' : '推荐服务暂时不可用，请稍后重试。'}</p>
            {featured.isError ? <button type="button" onClick={() => void featured.refetch()}>重新加载</button> : null}
          </div>
        )}
      </section>

      <IpadEditionContinueWatching />

      <section className="ipad-edition__today" aria-label="今日热门">
        <div className="ipad-edition__section-heading">
          <div><p className="ipad-edition__eyebrow">NOW SHOWING</p><h2>今日热门</h2></div>
          <Link href={searchHref('热门')}>全部内容 <span aria-hidden="true">›</span></Link>
        </div>
        {renderRail('ipad-popular-movies', '热门电影', movies.data?.items ?? [], movies.isLoading, movies.isError)}
      </section>

      {renderRail('ipad-popular-series', '热门剧集', series.data?.items ?? [], series.isLoading, series.isError)}
      {renderRail('ipad-new-releases', '新近上线', newReleases.data?.items ?? [], newReleases.isLoading, newReleases.isError)}

      <section className="ipad-edition__rail-section" id="ipad-anime-calendar" aria-labelledby="ipad-anime-title">
        <div className="ipad-edition__section-heading">
          <div><p className="ipad-edition__eyebrow">WEEKLY SIMULCAST</p><h2 id="ipad-anime-title">今日新番</h2></div>
          <span className="ipad-edition__section-note">Bangumi 每日放送</span>
        </div>
        {calendar.isLoading ? <div className="ipad-edition__rail-message">正在读取每日放送…</div> : calendar.isError ? <div className="ipad-edition__rail-message">新番日历暂时不可用。</div> : todayItems.length ? (
          <div className="ipad-edition__anime-grid">
            {todayItems.slice(0, 5).map((item) => (
              <Link href={searchHref(item.title)} className="ipad-edition__anime-card" key={item.id}>
                <span><SmartImage url={item.cover} mode={imageProxyMode} customProxy={customImageProxy} alt={item.title} /></span>
                <strong>{item.title}</strong>
                {item.rating ? <small>★ {item.rating}</small> : null}
              </Link>
            ))}
          </div>
        ) : <div className="ipad-edition__rail-message">今天暂无可展示的新番条目。</div>}
      </section>
    </div>
  );
}
