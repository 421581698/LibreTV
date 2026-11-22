'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IpadEditionHero } from '@/components/ipad-edition/IpadEditionHero';
import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { api } from '@/lib/client-api';
import type { DoubanItem } from '@/lib/types';
import { fromBangumiItem, fromTmdbItem } from '@/lib/poster';
import { IpadEditionContinueWatching } from '@/components/ipad-edition/IpadEditionContinueWatching';
import { TmdbAttribution } from '@/components/ipad-edition/TmdbAttribution';

const RAIL_SIZE = 10;
const HERO_SIZE = 5;

function searchHref(title: string) {
  return '/ipad-edition/search?q=' + encodeURIComponent(title);
}

export function IpadEditionHome() {
  const [activeHero, setActiveHero] = useState(0);

  // TMDB China recommendations feed the hero and today's movie rail from one cached request.
  const featured = useQuery({
    queryKey: ['ipad-edition-home-featured', 'CN'],
    queryFn: ({ signal }) => api.tmdbDiscover('movie', '热门', 1, signal),
    staleTime: 5 * 60_000,
  });

  const series = useQuery({
    queryKey: ['ipad-edition-series'],
    queryFn: ({ signal }) => api.tmdbDiscover('tv', '热门', 1, signal),
    staleTime: 5 * 60_000,
  });

  const newReleases = useQuery({
    queryKey: ['ipad-edition-new'],
    queryFn: ({ signal }) => api.tmdbDiscover('movie', '最新', 1, signal),
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
    retry: () => Promise<unknown>,
  ) => (
    <section className="ipad-edition__rail-section" id={id} aria-labelledby={id + '-title'}>
      <div className="ipad-edition__section-heading ipad-edition__gallery-heading">
        <div>
          <p className="ipad-edition__eyebrow">LIBRETV · COLLECTION</p>
          <h2 id={id + '-title'}>{title}</h2>
        </div>
        {items.length > 5 ? (
          <div className="ipad-edition__gallery-controls" role="group" aria-label={title + '画廊导航'}>
            <button type="button" aria-label={'向左浏览' + title} onClick={() => document.getElementById(id + '-track')?.scrollBy({ left: -Math.max(320, window.innerWidth * 0.62), behavior: 'smooth' })}>‹</button>
            <button type="button" aria-label={'向右浏览' + title} onClick={() => document.getElementById(id + '-track')?.scrollBy({ left: Math.max(320, window.innerWidth * 0.62), behavior: 'smooth' })}>›</button>
          </div>
        ) : null}
      </div>
      {loading ? (
        <div id={id + '-track'} className="ipad-edition__poster-grid" aria-label={title + '加载中'} aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="ipad-edition__poster-skeleton" key={index} />
          ))}
        </div>
      ) : error ? (
        <div className="ipad-edition__rail-message" role="alert">
          <span>暂时无法获取{title}。</span>
          <button type="button" onClick={() => void retry()}>重新加载</button>
        </div>
      ) : items.length ? (
        <div id={id + '-track'} className="ipad-edition__poster-grid" aria-label={title} role="region" tabIndex={0}>
          {items.slice(0, RAIL_SIZE).map((item, index) => (
            <Link className="ipad-edition__poster-card" data-ipad-poster-slot={id === 'ipad-popular-series' ? 'series' : id === 'ipad-new-releases' ? 'new-release' : 'movie'} data-poster-url={item.cover ?? ''} href={searchHref(item.title)} key={item.id || item.title}>
              <PosterRenderer variant="poster" frameClassName="ipad-edition__poster-art" asset={fromTmdbItem(item)} url={item.cover} mode="proxy" alt={item.title}>
                <span className="ipad-edition__poster-rank">{index + 1}</span>
              </PosterRenderer>
              <strong title={item.title}>{item.title}</strong>
              <small>{item.rating ? '★ ' + item.rating : '影视推荐'}</small>
            </Link>
          ))}
        </div>
      ) : (
        <div className="ipad-edition__rail-message">
          <span>当前没有可展示的真实内容。</span>
          <button type="button" onClick={() => void retry()}>重新加载</button>
        </div>
      )}
    </section>
  );

  return (
    <div className="ipad-edition__home">
      {hero ? (
        <IpadEditionHero items={heroItems} activeIndex={activeHero % heroItems.length} onSelect={setActiveHero} />
      ) : (
        <section className="ipad-edition__cinema-hero ipad-edition__cinema-hero--empty" aria-label="精选影片">
          <div className="ipad-edition__cinema-hero-copy" role="status">
            <p className="ipad-edition__cinema-hero-kicker">LIBRETV · 精选推荐</p>
            <h1>{featured.isLoading ? '正在为你准备影院' : '精选内容暂不可用'}</h1>
            <p>{featured.isLoading ? '正在获取中国影视推荐…' : 'TMDB 推荐服务暂时不可用，请稍后重试。'}</p>
            {featured.isError ? (
              <button type="button" onClick={() => void featured.refetch()}>重新加载</button>
            ) : null}
          </div>
        </section>
      )}

      {renderRail('ipad-popular-movies', '今日热门', movieItems, featured.isLoading, featured.isError, featured.refetch)}

      <IpadEditionContinueWatching />

      {renderRail('ipad-popular-series', '热门剧集', series.data?.items ?? [], series.isLoading, series.isError, series.refetch)}
      {renderRail('ipad-new-releases', '新近上线', newReleases.data?.items ?? [], newReleases.isLoading, newReleases.isError, newReleases.refetch)}

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
                <PosterRenderer variant="anime" asset={fromBangumiItem(item)} url={item.cover} mode="proxy" alt={item.title} />
                <strong>{item.title}</strong>
                {item.rating ? <small>★ {item.rating}</small> : null}
              </Link>
            ))}
          </div>
        ) : (
          <div className="ipad-edition__rail-message">今天暂无可展示的新番条目。</div>
        )}
      </section>
      <TmdbAttribution />
    </div>
  );
}
