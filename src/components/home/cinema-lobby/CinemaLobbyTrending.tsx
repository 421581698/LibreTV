'use client';

import { RecommendSection } from '@/components/douban-section';
import { useCinemaLobbyVisibility } from '@/components/home/cinema-lobby/useCinemaLobbyVisibility';

type CinemaLobbyTrendingProps = {
  enabled: boolean;
  onPick: (title: string) => void;
};

/**
 * 影院大堂的首个内容区。
 * 复用既有推荐数据源、缓存、骨架屏与卡片点击搜索逻辑。
 */
export function CinemaLobbyTrending({
  enabled,
  onPick,
}: CinemaLobbyTrendingProps) {
  const { ref, isNearViewport } = useCinemaLobbyVisibility<HTMLElement>();

  if (!enabled) return null;

  return (
    <section
      ref={ref}
      className="cinema-lobby-trending"
      aria-labelledby="cinema-lobby-trending-title"
    >
      <div className="cinema-lobby-section-heading">
        <div>
          <p className="cinema-lobby-section-eyebrow">DISCOVER</p>
          <h2
            id="cinema-lobby-trending-title"
            className="home-v2-trending-title"
          >
            今日热门
          </h2>
        </div>
        <span className="cinema-lobby-section-note">精选影视</span>
      </div>
      {isNearViewport ? (
        <RecommendSection onPick={onPick} />
      ) : (
        <div
          className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8"
          aria-hidden="true"
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="min-w-0">
              <div className="aspect-[2/3] animate-pulse rounded-lg bg-chip" />
              <div className="mt-2 h-3 animate-pulse rounded bg-chip" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
