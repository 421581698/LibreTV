'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { DoubanCard } from '@/components/video-card';

type CinemaLobbyCultureSectionsProps = {
  enabled: boolean;
  onPick: (title: string) => void;
};

/** 动漫与综艺独立内容流：复用 Bangumi 日历及现有 60s 榜单接口。 */
export function CinemaLobbyCultureSections({
  enabled,
  onPick,
}: CinemaLobbyCultureSectionsProps) {
  const animeQuery = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
    enabled,
  });
  const domesticVarietyQuery = useQuery({
    queryKey: ['hot-list', 'douban_show_chinese'],
    queryFn: ({ signal }) => api.hotList('douban_show_chinese', signal),
    enabled,
  });
  const globalVarietyQuery = useQuery({
    queryKey: ['hot-list', 'douban_show_global'],
    queryFn: ({ signal }) => api.hotList('douban_show_global', signal),
    enabled,
  });

  if (!enabled) return null;

  const animeItems = [...new Map(
    (animeQuery.data?.days.flatMap((day) => day.items) ?? [])
      .map((item) => [item.id, item])
  ).values()].slice(0, 18);
  const varietyItems = [
    ...(domesticVarietyQuery.data?.items ?? []),
    ...(globalVarietyQuery.data?.items ?? []),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 18);

  return (
    <>
      <section
        className="cinema-lobby-anime cinema-lobby-trending"
        aria-labelledby="cinema-lobby-anime-title"
      >
        <div className="cinema-lobby-section-heading">
          <div>
            <p className="cinema-lobby-section-eyebrow">ANIME</p>
            <h2 id="cinema-lobby-anime-title" className="home-v2-trending-title">
              动漫精选
            </h2>
          </div>
          <span className="cinema-lobby-section-note">每日放送</span>
        </div>
        {animeQuery.isError ? (
          <SectionError onRetry={() => void animeQuery.refetch()} />
        ) : animeQuery.isLoading ? (
          <PosterSkeleton />
        ) : animeItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">暂时没有可展示的动漫</p>
        ) : (
          <PosterGrid>
            {animeItems.map((item) => (
              <DoubanCard
                key={item.id}
                item={item}
                isTv={item.isTv ?? true}
                enableTmdbFallback
                onClick={() => onPick(item.title)}
              />
            ))}
          </PosterGrid>
        )}
      </section>

      <section
        className="cinema-lobby-variety cinema-lobby-trending"
        aria-labelledby="cinema-lobby-variety-title"
      >
        <div className="cinema-lobby-section-heading">
          <div>
            <p className="cinema-lobby-section-eyebrow">VARIETY</p>
            <h2 id="cinema-lobby-variety-title" className="home-v2-trending-title">
              综艺热播
            </h2>
          </div>
          <span className="cinema-lobby-section-note">国内 · 海外</span>
        </div>
        {domesticVarietyQuery.isError && globalVarietyQuery.isError ? (
          <SectionError
            onRetry={() => {
              void domesticVarietyQuery.refetch();
              void globalVarietyQuery.refetch();
            }}
          />
        ) : domesticVarietyQuery.isLoading || globalVarietyQuery.isLoading ? (
          <PosterSkeleton />
        ) : varietyItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">暂时没有可展示的综艺</p>
        ) : (
          <PosterGrid>
            {varietyItems.map((item) => (
              <DoubanCard
                key={item.id}
                item={item}
                onClick={() => onPick(item.title)}
              />
            ))}
          </PosterGrid>
        )}
      </section>
    </>
  );
}

function PosterGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {children}
    </div>
  );
}

function PosterSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="min-w-0">
          <div className="aspect-[2/3] animate-pulse rounded-lg bg-chip" />
          <div className="mt-2 h-3 animate-pulse rounded bg-chip" />
        </div>
      ))}
    </div>
  );
}

function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-faint">内容暂时加载失败</p>
      <button
        type="button"
        className="mt-2 rounded-full bg-chip px-3 py-1.5 text-xs text-muted hover:text-content"
        onClick={onRetry}
      >
        重新加载
      </button>
    </div>
  );
}
