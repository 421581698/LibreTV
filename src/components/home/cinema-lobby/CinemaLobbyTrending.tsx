'use client';

import { RecommendSection } from '@/components/douban-section';
import { useAppStore } from '@/lib/store';
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
  const { ref, isNearViewport } = useCinemaLobbyVisibility<HTMLElement>(enabled);
  const doubanEnabled = useAppStore((state) => state.doubanEnabled);

  // 推荐源关闭时隐藏整个模块，避免留下没有内容的标题和骨架区。
  if (!enabled || !doubanEnabled) return null;

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
        <RecommendSection onPick={onPick} cinemaLobbyLayout />
      ) : (
        <div
          className="flex gap-3 overflow-hidden -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 sm:gap-2.5"
          aria-hidden="true"
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="w-[38vw] max-w-[160px] shrink-0 sm:w-auto sm:max-w-none sm:min-w-0">
              <div className="aspect-[2/3] animate-pulse rounded-lg bg-chip" />
              <div className="mt-2 h-3 animate-pulse rounded bg-chip" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
