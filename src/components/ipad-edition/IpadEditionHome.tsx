'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IpadEditionHero } from '@/components/ipad-edition/IpadEditionHero';
import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { DoubanItem } from '@/lib/types';
import { fromBangumiItem, fromTmdbItem } from '@/lib/poster';
import { IpadEditionContinueWatching } from '@/components/ipad-edition/IpadEditionContinueWatching';
import { useIpadEditionPosterNavigation } from '@/components/ipad-edition/useIpadEditionPosterNavigation';

const RAIL_SIZE = 10;
const HERO_SIZE = 5;
const LATEST_RELEASE_RAIL_SIZE = 30;

async function fetchRegionalMovieSearch(query: string, region: 'US' | 'CN', signal?: AbortSignal): Promise<{ items: DoubanItem[] }> {
  const params = new URLSearchParams({ query, region });
  const response = await fetch('/api/tmdb/search?' + params.toString(), { signal });
  if (!response.ok) throw new Error('TMDB 影片检索暂时不可用');
  return response.json() as Promise<{ items: DoubanItem[] }>;
}

function mergeLatestRegionalReleases(usItems: DoubanItem[], cnItems: DoubanItem[]): DoubanItem[] {
  const byId = new Map<string, DoubanItem>();
  for (const item of [...usItems, ...cnItems]) {
    if (!item.id || !item.title?.trim() || !item.cover?.trim() || !item.releaseDate) continue;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
    } else {
      // The same movie can have different US/CN release dates. Do not
      // mislabel the later date as if it were identical in both countries.
      const preferred = item.releaseDate > (existing.releaseDate ?? '') ? item : existing;
      const combinedRegion = existing.releaseRegion === item.releaseRegion || existing.releaseDate !== item.releaseDate
        ? preferred.releaseRegion
        : 'BOTH';
      byId.set(item.id, { ...preferred, releaseRegion: combinedRegion });
    }
  }
  return [...byId.values()].sort((a, b) =>
    (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') ||
    a.title.localeCompare(b.title, 'zh-CN'),
  );
}

export function IpadEditionHome() {
  const [activeHero, setActiveHero] = useState(0);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const { openPoster, pendingTitle, error } = useIpadEditionPosterNavigation();

  const featured = useQuery({
    queryKey: ['ipad-edition-home-featured', 'GLOBAL'],
    queryFn: ({ signal }) => api.tmdbDiscover('movie', '热门', 1, signal, 'GLOBAL'),
    staleTime: 5 * 60_000,
  });

  const series = useQuery({
    queryKey: ['ipad-edition-series', 'GLOBAL'],
    queryFn: ({ signal }) => api.tmdbDiscover('tv', '热门', 1, signal, 'GLOBAL'),
    staleTime: 5 * 60_000,
  });

  const latestCN = useQuery({
    queryKey: ['ipad-edition-latest-releases', 'CN'],
    queryFn: ({ signal }) => api.tmdbDiscover('movie', '最新', 1, signal, 'CN'),
    staleTime: 15 * 60_000,
  });

  const latestUS = useQuery({
    queryKey: ['ipad-edition-latest-releases', 'US'],
    queryFn: ({ signal }) => api.tmdbDiscover('movie', '最新', 1, signal, 'US'),
    staleTime: 15 * 60_000,
  });

  // Exact-title lookups keep notable recent releases from being omitted when
  // TMDB's popularity/release-date discovery page is crowded.
  const spiderManUS = useQuery({
    queryKey: ['ipad-edition-release-title', 'spider-man-brand-new-day', 'US'],
    queryFn: ({ signal }) => fetchRegionalMovieSearch('Spider-Man: Brand New Day', 'US', signal),
    staleTime: 60 * 60_000,
  });
  const spiderManCN = useQuery({
    queryKey: ['ipad-edition-release-title', 'spider-man-brand-new-day', 'CN'],
    queryFn: ({ signal }) => fetchRegionalMovieSearch('Spider-Man: Brand New Day', 'CN', signal),
    staleTime: 60 * 60_000,
  });
  const odysseyUS = useQuery({
    queryKey: ['ipad-edition-release-title', 'the-odyssey', 'US'],
    queryFn: ({ signal }) => fetchRegionalMovieSearch('The Odyssey', 'US', signal),
    staleTime: 60 * 60_000,
  });
  const odysseyCN = useQuery({
    queryKey: ['ipad-edition-release-title', 'the-odyssey', 'CN'],
    queryFn: ({ signal }) => fetchRegionalMovieSearch('The Odyssey', 'CN', signal),
    staleTime: 60 * 60_000,
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

  const latestItems = useMemo(
    () => mergeLatestRegionalReleases(
      [
        ...(latestUS.data?.items ?? []),
        ...(latestCN.data?.items ?? []),
        ...(spiderManUS.data?.items ?? []),
        ...(spiderManCN.data?.items ?? []),
        ...(odysseyUS.data?.items ?? []),
        ...(odysseyCN.data?.items ?? []),
      ],
      [],
    ),
    [latestUS.data, latestCN.data, spiderManUS.data, spiderManCN.data, odysseyUS.data, odysseyCN.data],
  );

  const heroItems = movieItems.slice(0, HERO_SIZE);
  const hero = heroItems.length ? heroItems[activeHero % heroItems.length] : undefined;
  const today = ((new Date().getDay() + 6) % 7) + 1;
  const todayItems = calendar.data?.days.find((day) => day.weekday === today)?.items ?? [];

  const renderRail = (
    id: string,
    title: string,
    items: DoubanItem[],
    loading: boolean,
    hasError: boolean,
    retry: () => Promise<unknown>,
    showReleaseMeta = false,
    maxItems = RAIL_SIZE,
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
      {loading && !items.length ? (
        <div id={id + '-track'} className="ipad-edition__poster-grid" aria-label={title + '加载中'} aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="ipad-edition__poster-skeleton" key={index} />
          ))}
        </div>
      ) : hasError && !items.length ? (
        <div className="ipad-edition__rail-message" role="alert">
          <span>暂时无法获取{title}。</span>
          <button type="button" onClick={() => void retry()}>重新加载</button>
        </div>
      ) : items.length ? (
        <div id={id + '-track'} className="ipad-edition__poster-grid" aria-label={title} role="region" tabIndex={0}>
          {items.slice(0, maxItems).map((item, index) => (
            <button type="button" className="ipad-edition__poster-card appearance-none border-0 bg-transparent p-0 text-left font-[inherit] text-inherit" data-ipad-poster-slot={id === 'ipad-popular-series' ? 'series' : id === 'ipad-new-releases' ? 'new-release' : 'movie'} data-poster-url={item.cover ?? ''} aria-label={'查看 ' + item.title + ' 的详情'} aria-busy={pendingTitle === item.title} disabled={Boolean(pendingTitle)} onClick={() => void openPoster(item)} key={item.id || item.title}>
              <PosterRenderer variant="poster" frameClassName="ipad-edition__poster-art" asset={fromTmdbItem(item)} url={item.cover} hdrUrl={item.coverHdr} mode={imageProxyMode} customProxy={customImageProxy} alt={item.title}>
                <span className="ipad-edition__poster-rank">{index + 1}</span>
              </PosterRenderer>
              <strong title={item.title}>{item.title}</strong>
              {showReleaseMeta ? (
                <small>{item.releaseDate} · {item.releaseRegion === 'BOTH' ? '美国／中国上映' : item.releaseRegion === 'US' ? '美国上映' : '中国上映'}</small>
              ) : null}
            </button>
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
        <IpadEditionHero items={heroItems} activeIndex={activeHero % heroItems.length} onSelect={setActiveHero} onOpen={openPoster} pendingTitle={pendingTitle} />
      ) : (
        <section className="ipad-edition__cinema-hero ipad-edition__cinema-hero--empty" aria-label="精选影片">
          <div className="ipad-edition__cinema-hero-copy" role="status">
            <p className="ipad-edition__cinema-hero-kicker">LIBRETV · 精选推荐</p>
            <h1>{featured.isLoading ? '正在为你准备影院' : '精选内容暂不可用'}</h1>
            <p>{featured.isLoading ? '正在获取全球热门影视…' : 'TMDB 推荐服务暂时不可用，请稍后重试。'}</p>
            {!featured.isLoading ? (
              <button type="button" onClick={() => void featured.refetch()}>重新加载</button>
            ) : null}
          </div>
        </section>
      )}

      {error ? <p className="ipad-edition__rail-message" role="alert">{error}</p> : null}

      {renderRail('ipad-popular-movies', '今日热门', movieItems, featured.isLoading, featured.isError, featured.refetch)}

      <IpadEditionContinueWatching />

      {renderRail('ipad-popular-series', '热门剧集', (series.data?.items ?? []).filter((item, index, list) => Boolean(item.id && item.title?.trim() && item.cover?.trim()) && list.findIndex((candidate) => candidate.id === item.id) === index), series.isLoading, series.isError, series.refetch)}
      {renderRail('ipad-new-releases', '美国 · 中国最新上映', latestItems, latestUS.isLoading || latestCN.isLoading || spiderManUS.isLoading || spiderManCN.isLoading || odysseyUS.isLoading || odysseyCN.isLoading, latestUS.isError && latestCN.isError && spiderManUS.isError && spiderManCN.isError && odysseyUS.isError && odysseyCN.isError, async () => { await Promise.all([latestUS.refetch(), latestCN.refetch(), spiderManUS.refetch(), spiderManCN.refetch(), odysseyUS.refetch(), odysseyCN.refetch()]); }, true, LATEST_RELEASE_RAIL_SIZE)}

      <section className="ipad-edition__rail-section" id="ipad-anime-calendar" aria-labelledby="ipad-anime-title">
        <div className="ipad-edition__section-heading">
          <h2 id="ipad-anime-title">今日新番</h2>
        </div>
        {calendar.isLoading ? (
          <div className="ipad-edition__rail-message" role="status">正在读取每日放送…</div>
        ) : calendar.isError ? (
          <div className="ipad-edition__rail-message" role="status">新番日历暂时不可用。<button type="button" onClick={() => void calendar.refetch()}>重新加载</button></div>
        ) : todayItems.length ? (
          <div className="ipad-edition__anime-grid">
            {todayItems.slice(0, 5).map((item) => (
              <button type="button" className="ipad-edition__anime-card appearance-none border-0 bg-transparent p-0 text-left font-[inherit] text-inherit" data-ipad-poster-slot="anime" data-poster-url={item.cover ?? ''} aria-label={'查看 ' + item.title + ' 的详情'} aria-busy={pendingTitle === item.title} disabled={Boolean(pendingTitle)} onClick={() => void openPoster(item)} key={item.id}>
                <PosterRenderer variant="anime" asset={fromBangumiItem(item)} url={item.cover} hdrUrl={item.coverHdr} mode={imageProxyMode} customProxy={customImageProxy} alt={item.title} />
                <strong>{item.title}</strong>
              </button>
            ))}
          </div>
        ) : (
          <div className="ipad-edition__rail-message">今天暂无可展示的新番条目。</div>
        )}
      </section>
    </div>
  );
}
