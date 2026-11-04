'use client';

import { Children, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { DoubanCard } from '@/components/video-card';
import { useCinemaLobbyVisibility } from '@/components/home/cinema-lobby/useCinemaLobbyVisibility';

const mobileRailClass =
  'flex gap-3 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-3 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 sm:gap-2.5 sm:overflow-visible sm:pb-0';
const mobileCardClass =
  'w-[38vw] max-w-[160px] shrink-0 snap-start sm:w-auto sm:max-w-none';

type CinemaLobbyCultureSectionsProps = {
  enabled: boolean;
  onPick: (title: string) => void;
};

/** 动漫与综艺独立内容流：复用 Bangumi 日历及现有 60s 榜单接口。 */
export function CinemaLobbyCultureSections({
  enabled,
  onPick,
}: CinemaLobbyCultureSectionsProps) {
  const { ref, isNearViewport } = useCinemaLobbyVisibility<HTMLDivElement>(enabled);
  const shouldLoad = enabled && isNearViewport;
  const animeQuery = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
    enabled: shouldLoad,
  });
  const domesticVarietyQuery = useQuery({
    queryKey: ['hot-list', 'douban_show_chinese'],
    queryFn: ({ signal }) => api.hotList('douban_show_chinese', signal),
    enabled: shouldLoad,
  });
  const globalVarietyQuery = useQuery({
    queryKey: ['hot-list', 'douban_show_global'],
    queryFn: ({ signal }) => api.hotList('douban_show_global', signal),
    enabled: shouldLoad,
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
    <div ref={ref} className="cinema-lobby-culture-sections">
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
        <div aria-busy={!isNearViewport || animeQuery.isLoading} aria-live="polite">
        {animeQuery.isError ? (
          <SectionError onRetry={() => void animeQuery.refetch()} />
        ) : !isNearViewport || animeQuery.isLoading ? (
          <PosterSkeleton />
        ) : animeItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint" role="status">暂时没有可展示的动漫</p>
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
        </div>
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
        <div
          aria-busy={!isNearViewport || domesticVarietyQuery.isLoading || globalVarietyQuery.isLoading}
          aria-live="polite"
        >
        {domesticVarietyQuery.isError && globalVarietyQuery.isError ? (
          <SectionError
            onRetry={() => {
              void domesticVarietyQuery.refetch();
              void globalVarietyQuery.refetch();
            }}
          />
        ) : !isNearViewport || domesticVarietyQuery.isLoading || globalVarietyQuery.isLoading ? (
          <PosterSkeleton />
        ) : varietyItems.length === 0 && (domesticVarietyQuery.isError || globalVarietyQuery.isError) ? (
          <SectionError
            onRetry={() => {
              void domesticVarietyQuery.refetch();
              void globalVarietyQuery.refetch();
            }}
          />
        ) : varietyItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint" role="status">暂时没有可展示的综艺</p>
        ) : (
          <>
            {(domesticVarietyQuery.isError || globalVarietyQuery.isError) && (
              <p className="mb-3 text-xs text-faint" role="status">
                部分综艺来源暂时不可用，以下为已获取内容
              </p>
            )}
            <PosterGrid>
              {varietyItems.map((item) => (
                <DoubanCard
                  key={item.id}
                  item={item}
                  onClick={() => onPick(item.title)}
                />
              ))}
            </PosterGrid>
          </>
        )}
        </div>
      </section>
    </div>
  );
}

function PosterGrid({ children }: { children: ReactNode }) {
  return (
    <div className={mobileRailClass}>
      {Children.map(children, (child) => (
        <div className={mobileCardClass}>{child}</div>
      ))}
    </div>
  );
}

function PosterSkeleton() {
  return (
    <div className={mobileRailClass} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className={mobileCardClass}>
          <div className="aspect-[2/3] animate-pulse rounded-lg bg-chip" />
          <div className="mt-2 h-3 animate-pulse rounded bg-chip" />
        </div>
      ))}
    </div>
  );
}

function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-6 text-center" role="alert">
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
