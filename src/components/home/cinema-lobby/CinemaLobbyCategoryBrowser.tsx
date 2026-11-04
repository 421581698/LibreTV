'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { DoubanCard } from '@/components/video-card';
import { useCinemaLobbyVisibility } from '@/components/home/cinema-lobby/useCinemaLobbyVisibility';

type MediaType = 'movie' | 'tv';

const CATEGORY_TAGS: Record<MediaType, string[]> = {
  movie: ['科幻', '悬疑', '动作', '喜剧', '爱情', '犯罪', '惊悚', '动画', '纪录片', '奇幻'],
  tv: ['悬疑', '爱情', '喜剧', '犯罪', '动作', '科幻', '古装', '都市', '纪录片', '动画'],
};

type Props = {
  enabled: boolean;
  onPick: (title: string) => void;
};

/** 分类浏览使用现有豆瓣标签查询，不新增数据接口或点播 ID 映射。 */
export function CinemaLobbyCategoryBrowser({ enabled, onPick }: Props) {
  const { ref, isNearViewport } = useCinemaLobbyVisibility<HTMLElement>(enabled);
  const [type, setType] = useState<MediaType>('movie');
  const [tag, setTag] = useState('科幻');
  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 18, signal),
    enabled: enabled && isNearViewport,
  });

  if (!enabled) return null;
  const tags = CATEGORY_TAGS[type];
  const items = query.data?.items ?? [];

  const switchType = (next: MediaType) => {
    if (next === type) return;
    setType(next);
    setTag(CATEGORY_TAGS[next][0]);
  };

  return (
    <section
      ref={ref}
      className="cinema-lobby-categories cinema-lobby-trending"
      aria-labelledby="cinema-lobby-categories-title"
    >
      <div className="cinema-lobby-section-heading">
        <div>
          <p className="cinema-lobby-section-eyebrow">EXPLORE BY GENRE</p>
          <h2 id="cinema-lobby-categories-title" className="home-v2-trending-title">
            分类浏览
          </h2>
        </div>
        <span className="cinema-lobby-section-note">按兴趣发现好片</span>
      </div>

      <div className="cinema-lobby-category-toolbar">
        <div className="cinema-lobby-category-types" aria-label="选择内容类型">
          <button type="button" aria-pressed={type === 'movie'} className={type === 'movie' ? 'is-active' : ''} onClick={() => switchType('movie')}>电影</button>
          <button type="button" aria-pressed={type === 'tv'} className={type === 'tv' ? 'is-active' : ''} onClick={() => switchType('tv')}>剧集</button>
        </div>
        <div className="cinema-lobby-category-tags" aria-label="选择题材">
          {tags.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={tag === item}
              className={tag === item ? 'is-active' : ''}
              onClick={() => setTag(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {query.isError ? (
        <div className="py-6 text-center">
          <p className="text-sm text-faint">分类内容暂时加载失败</p>
          <button type="button" className="mt-2 rounded-full bg-chip px-3 py-1.5 text-xs text-muted" onClick={() => void query.refetch()}>重新加载</button>
        </div>
      ) : !isNearViewport || query.isLoading ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="min-w-0">
              <div className="aspect-[2/3] animate-pulse rounded-lg bg-chip" />
              <div className="mt-2 h-3 animate-pulse rounded bg-chip" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">这个分类暂时没有推荐内容</p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {items.map((item) => (
            <DoubanCard
              key={item.id}
              item={item}
              isTv={type === 'tv'}
              enableTmdbFallback
              onClick={() => onPick(item.title)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
