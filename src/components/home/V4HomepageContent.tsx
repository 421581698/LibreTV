'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery } from '@tanstack/react-query';
import { RecommendSection } from '@/components/douban-section';
import { GlassPanel } from '@/components/ui/glass';
import { SmartImage } from '@/components/smart-image';
import { api } from '@/lib/client-api';
import { db, type HistoryEntry } from '@/lib/db';
import { resolveSource, useAppStore } from '@/lib/store';
import type { DoubanItem } from '@/lib/types';
import { buildWatchUrl, formatTime } from '@/lib/utils';

const CONTINUE_LIMIT = 8;

export function V4HomepageContent({ onPick }: { onPick: (item: DoubanItem) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const history = useLiveQuery(
    () => db.history.orderBy('timestamp').reverse().limit(CONTINUE_LIMIT).toArray(),
    [],
  );
  const todayQuery = useQuery({
    queryKey: ['homepage-today-featured'],
    queryFn: ({ signal }) => api.douban('movie', '热门', 0, 8, signal),
    enabled: doubanEnabled,
    staleTime: 5 * 60_000,
  });
  const todayPick = todayQuery.data?.items.find((item) => item.cover);

  return (
    <>
      {doubanEnabled ? (
        <section className="v4-content-section v4-today-section" id="today-recommendations" aria-label="今日推荐">
          <div className="v4-section-heading">
            <h2>今日推荐 <span aria-hidden="true">›</span></h2>
          </div>
          {todayQuery.isLoading ? (
            <div className="v4-today-featured-skeleton" role="status">正在载入今日推荐…</div>
          ) : todayQuery.isError ? (
            <GlassPanel className="v4-history-empty" role="status">今日推荐暂时无法加载，请稍后重试。</GlassPanel>
          ) : todayPick ? (
            <button type="button" className="v4-today-featured" onClick={() => onPick(todayPick)}>
              <span className="v4-today-poster">
                <SmartImage
                  url={todayPick.cover}
                  mode={imageProxyMode}
                  customProxy={customImageProxy}
                  alt={todayPick.title}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </span>
              <span className="v4-today-copy">
                <span className="v4-today-eyebrow">TODAY&apos;S PICK</span>
                <strong>{todayPick.title}</strong>
                <span className="v4-today-meta">{[todayPick.rating ? `评分 ${todayPick.rating}` : ''].filter(Boolean).join(' · ')}</span>
                <span className="v4-today-cta">▶ 立即观看</span>
              </span>
            </button>
          ) : (
            <GlassPanel className="v4-history-empty">今日暂无可展示的推荐影片。</GlassPanel>
          )}
        </section>
      ) : null}

      <section className="v4-content-section v4-continue-section" id="my-library" aria-label="继续观看">
        <div className="v4-section-heading">
          <h2>继续观看 <span aria-hidden="true">›</span></h2>
          {history && history.length > 0 ? <span className="v4-history-count">最近 {history.length} 部</span> : null}
        </div>
        {!history ? (
          <GlassPanel className="v4-history-empty" role="status">正在读取本机观看记录…</GlassPanel>
        ) : history.length === 0 ? (
          <GlassPanel className="v4-history-empty">还没有观看记录，开始播放后会显示在这里。</GlassPanel>
        ) : (
          <div className="v4-history-row">
            {history.map((item) => (
              <V4ContinueCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {doubanEnabled ? (
        <section className="v4-content-section v4-recommendation-section" id="for-you" aria-label="为你推荐">
          <div className="v4-section-heading">
            <h2>为你推荐 <span aria-hidden="true">›</span></h2>
          </div>
          <RecommendSection onPick={onPick} />
        </section>
      ) : null}
    </>
  );
}

function V4ContinueCard({ item }: { item: HistoryEntry }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey);
  const href = buildWatchUrl({
    sourceKey: item.sourceKey,
    vodId: item.vodId,
    index: item.episodeIndex,
    title: item.title,
    sourceUrl: source?.url ?? item.sourceUrl,
    detail: source?.detail,
  });
  const percent = item.duration > 0
    ? Math.max(0, Math.min(100, Math.round((item.playbackPosition / item.duration) * 100)))
    : 0;

  return (
    <Link className="v4-history-card" href={href}>
      <div className="v4-history-image">
        {item.pic ? (
          <SmartImage
            url={item.pic}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={item.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : <span className="v4-history-image-fallback" aria-hidden="true">▶</span>}
        <span className="v4-history-play" aria-hidden="true">▶</span>
      </div>
      <div className="v4-history-copy">
        <strong title={item.title}>{item.title}</strong>
        <span>第 {item.episodeIndex + 1} 集 · {formatTime(item.playbackPosition)}{item.duration > 0 ? ` / ${formatTime(item.duration)}` : ''}</span>
        <div className="v4-progress-track" role="progressbar" aria-label={`${item.title} 播放进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
    </Link>
  );
}
