'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { DoubanCard } from '@/components/video-card';
import { useCinemaLobbyVisibility } from '@/components/home/cinema-lobby/useCinemaLobbyVisibility';

type CinemaLobbyTvSectionProps = {
  enabled: boolean;
  onPick: (title: string) => void;
};

/**
 * 独立的热门电视剧流。
 * 复用现有豆瓣剧集 API 与海报卡片，点击仍交给首页原搜索协调器。
 */
export function CinemaLobbyTvSection({
  enabled,
  onPick,
}: CinemaLobbyTvSectionProps) {
  const { ref, isNearViewport } = useCinemaLobbyVisibility<HTMLElement>(enabled);
  const query = useQuery({
    queryKey: ['douban', 'tv', '热门'],
    queryFn: ({ signal }) => api.douban('tv', '热门', 0, 18, signal),
    enabled: enabled && isNearViewport,
  });

  if (!enabled) return null;

  const items = query.data?.items ?? [];

  return (
    <section
      ref={ref}
      className="cinema-lobby-tv cinema-lobby-trending"
      aria-labelledby="cinema-lobby-tv-title"
    >
      <div className="cinema-lobby-section-heading">
        <div>
          <p className="cinema-lobby-section-eyebrow">TV SERIES</p>
          <h2 id="cinema-lobby-tv-title" className="home-v2-trending-title">
            热门电视剧
          </h2>
        </div>
        <span className="cinema-lobby-section-note">剧集精选</span>
      </div>

      {!isNearViewport || query.isLoading ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="min-w-0">
              <div className="aspect-[2/3] animate-pulse rounded-lg bg-chip" />
              <div className="mt-2 h-3 animate-pulse rounded bg-chip" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <div className="py-6 text-center">
          <p className="text-sm text-faint">电视剧推荐暂时加载失败</p>
          <button
            type="button"
            className="mt-2 rounded-full bg-chip px-3 py-1.5 text-xs text-muted hover:text-content"
            onClick={() => void query.refetch()}
          >
            重新加载
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">暂时没有可展示的电视剧</p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {items.map((item) => (
            <DoubanCard
              key={item.id}
              item={item}
              isTv
              enableTmdbFallback
              onClick={() => onPick(item.title)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
