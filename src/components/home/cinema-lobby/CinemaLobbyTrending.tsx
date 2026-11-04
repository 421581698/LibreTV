'use client';

import { RecommendSection } from '@/components/douban-section';

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
  if (!enabled) return null;

  return (
    <section
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
      <RecommendSection onPick={onPick} />
    </section>
  );
}
