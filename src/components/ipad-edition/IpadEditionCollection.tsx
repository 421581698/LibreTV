'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import type { BangumiCalendarResponse, DoubanItem, DoubanResponse } from '@/lib/types';
import { fromBangumiItem, fromTmdbItem } from '@/lib/poster';

type CollectionKind = 'movie' | 'tv' | 'anime';
const tabs = ['热门', '最新', '高分'] as const;

function isCalendar(value: unknown): value is BangumiCalendarResponse {
  return typeof value === 'object' && value !== null && 'days' in value;
}

function isDouban(value: unknown): value is DoubanResponse {
  return typeof value === 'object' && value !== null && 'items' in value;
}

export function IpadEditionCollection({ kind, title }: { kind: CollectionKind; title: string }) {
  const [tag, setTag] = useState<(typeof tabs)[number]>('热门');
  const [page, setPage] = useState(0);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const query = useQuery<BangumiCalendarResponse | DoubanResponse>({
    queryKey: ['ipad-edition-collection', kind, tag, page],
    queryFn: async ({ signal }) => {
      if (kind === 'anime') return api.bangumiCalendar(signal);
      return api.tmdbDiscover(kind, tag, page + 1, signal);
    },
    staleTime: 5 * 60_000,
  });
  const items: DoubanItem[] = kind === 'anime'
    ? (isCalendar(query.data) ? query.data.days.flatMap((day) => day.items) : [])
    : (isDouban(query.data) ? query.data.items : []);
  const uniqueItems = items.filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);
  const heading = kind === 'anime' ? '每日放送' : tag + title;

  return (
    <div className="ipad-edition__page">
      <header className="ipad-edition__page-heading">
        <p className="ipad-edition__eyebrow">LIBRETV COLLECTION</p>
        <h1>{title}</h1>
        <p>{kind === 'anime' ? '来自 Bangumi 的真实每日放送日历。' : '默认展示中国影视作品，元数据与海报来自 TMDB。'}</p>
      </header>
      {kind !== 'anime' ? <div className="ipad-edition__collection-tabs" role="group" aria-label="内容排序">{tabs.map((item) => <button type="button" key={item} className={tag === item ? 'is-active' : ''} aria-pressed={tag === item} onClick={() => { setTag(item); setPage(0); }}>{item}</button>)}</div> : null}
      {query.isLoading ? <div className="ipad-edition__poster-grid">{Array.from({ length: 10 }).map((_, index) => <div className="ipad-edition__poster-skeleton" key={index} />)}</div> : null}
      {query.isError ? <div className="ipad-edition__rail-message" role="alert">暂时无法获取{title}，请稍后重试。<button type="button" onClick={() => void query.refetch()}>重试</button></div> : null}
      {!query.isLoading && !query.isError && uniqueItems.length === 0 ? <div className="ipad-edition__rail-message">当前分类没有可展示的真实内容。</div> : null}
      {uniqueItems.length ? (
        <>
          <div className="ipad-edition__section-heading"><div><p className="ipad-edition__eyebrow">NOW SHOWING</p><h2>{heading}</h2></div><span className="ipad-edition__section-note">{kind === 'anime' ? 'Bangumi' : '中国 · TMDB'} · {uniqueItems.length} 部作品</span></div>
          <div className="ipad-edition__collection-grid">
            {uniqueItems.map((item) => <Link className="ipad-edition__poster-card" href={'/ipad-edition/search?q=' + encodeURIComponent(item.title)} key={item.id}>
              <PosterRenderer variant="poster" frameClassName="ipad-edition__poster-art" asset={kind === 'anime' ? fromBangumiItem(item) : fromTmdbItem(item)} url={item.cover} mode={imageProxyMode} customProxy={customImageProxy} alt={item.title} />
              <strong title={item.title}>{item.title}</strong><small>{item.rating ? '★ ' + item.rating : '查看可播放资源'}</small>
            </Link>)}
          </div>
          {kind !== 'anime' ? <div className="ipad-edition__pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button><span>第 {page + 1} 页</span><button type="button" disabled={uniqueItems.length < 20} onClick={() => setPage((value) => value + 1)}>下一页</button></div> : null}
        </>
      ) : null}
    </div>
  );
}
