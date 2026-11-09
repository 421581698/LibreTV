'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client-api';
import { useAppStore, resolveSource } from '@/lib/store';
import type { SearchResultItem, SourceConfig, VideoDetail } from '@/lib/types';
import { validateSourceUrl } from '@/lib/utils';
import { clearProgress, db, progressKeyOf, saveProgress, updateHistoryProgress, upsertHistory } from '@/lib/db';

const PlayerShell = dynamic(
  () => import('@/components/player-shell').then((module) => module.PlayerShell),
  { ssr: false, loading: () => <div className="aspect-video w-full animate-pulse bg-black" /> },
);

export function HomeInlinePlayer({
  item,
  onClose,
}: {
  item: SearchResultItem | null;
  onClose: () => void;
}) {
  const customAPIs = useAppStore((state) => state.customAPIs);
  const envSources = useAppStore((state) => state.envSources);
  const adFilter = useAppStore((state) => state.adFilter);
  const autoSkipSegments = useAppStore((state) => state.autoSkipSegments);
  const autoplayNext = useAppStore((state) => state.autoplayNext);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [episodeIndex, setEpisodeIndex] = useState(0);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [showAutoNext, setShowAutoNext] = useState(false);
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const episodes = detail?.episodes ?? [];

  const source = useMemo<SourceConfig | null>(() => {
    if (!item) return null;
    const local = resolveSource({ customAPIs, envSources }, item.sourceKey);
    const sourceUrl = item.sourceUrl?.trim();
    if (item.sourceKey === 'friday-cms' && sourceUrl) {
      if (!validateSourceUrl(sourceUrl)) return null;
      return {
        ...(local ?? {}),
        key: item.sourceKey,
        name: item.sourceName,
        url: sourceUrl,
        detail: undefined,
      } as SourceConfig;
    }
    if (local) return local;
    if (sourceUrl && validateSourceUrl(sourceUrl)) {
      return { key: item.sourceKey, name: item.sourceName, url: sourceUrl };
    }
    return null;
  }, [item, customAPIs, envSources]);

  useEffect(() => {
    if (!item) {
      setDetail(null);
      setError('');
      setLoading(false);
      setEpisodeIndex(0);
      return;
    }
    setDetail(null);
    if (!source) {
      setError('播放源不存在或地址未通过安全校验，请到设置中检查点播源');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setDetail(null);
    setError('');
    setLoading(true);
    setEpisodeIndex(0);
    api.detail(item.vodId, source, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch((reason) => {
        if (controller.signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) return;
        setError(reason instanceof Error ? reason.message : '获取播放地址失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [item, source]);

  const handleProgress = useCallback((position: number, duration: number) => {
    if (!item) return;
    void saveProgress(item.sourceKey, item.vodId, episodeIndex, position, duration).catch(() => {});
    void updateHistoryProgress(item.sourceKey, item.vodId, position, duration).catch(() => {});
  }, [item, episodeIndex]);

  const getRestorePosition = useCallback(async () => {
    if (!item) return 0;
    const progress = await db.progress.get(progressKeyOf(item.sourceKey, item.vodId, episodeIndex));
    if (progress?.position) return progress.position;
    const history = await db.history.get(`${item.sourceKey}_${item.vodId}`);
    return history?.episodeIndex === episodeIndex && history.playbackPosition > 5
      ? history.playbackPosition
      : 0;
  }, [item, episodeIndex]);

  useEffect(() => {
    if (!item || !detail) return;
    void upsertHistory({
      sourceKey: item.sourceKey,
      sourceUrl: source?.url ?? item.sourceUrl,
      vodId: item.vodId,
      title: item.name,
      pic: item.pic,
      typeName: detail.videoInfo.typeName,
      year: detail.videoInfo.year,
      area: detail.videoInfo.area,
      episodeIndex,
      totalEpisodes: detail.episodes.length,
      playbackPosition: 0,
      duration: 0,
      timestamp: Date.now(),
    }).catch(() => {});
  }, [item, source, detail, episodeIndex]);
  const cancelAutoNext = useCallback(() => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    autoNextTimer.current = null;
    setShowAutoNext(false);
  }, []);

  const handleEnded = useCallback(() => {
    if (!item) return;
    void clearProgress(item.sourceKey, item.vodId, episodeIndex).catch(() => {});
    if (!autoplayNext || episodeIndex >= episodes.length - 1) return;
    cancelAutoNext();
    setShowAutoNext(true);
    autoNextTimer.current = setTimeout(() => {
      autoNextTimer.current = null;
      setShowAutoNext(false);
      setEpisodeIndex((index) => Math.min(episodes.length - 1, index + 1));
    }, 8000);
  }, [item, episodeIndex, episodes.length, autoplayNext, cancelAutoNext]);

  const goEpisode = useCallback((index: number) => {
    cancelAutoNext();
    setEpisodeIndex(Math.max(0, Math.min(episodes.length - 1, index)));
  }, [episodes.length, cancelAutoNext]);

  useEffect(() => () => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
  }, []);

  useEffect(() => {
    cancelAutoNext();
  }, [item, cancelAutoNext]);
  useEffect(() => {
    if (!item) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [item]);

  if (!item) return null;
  const currentUrl = episodes[episodeIndex];

  return (
    <div
      className="home-inline-player fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-black/95 p-3 sm:p-6"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="w-full max-w-5xl overflow-hidden rounded-2xl border border-white/15 bg-[#101014] text-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={`正在播放：${item.name}`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold sm:text-lg">{item.name}</h2>
            <p className="truncate text-xs text-white/55">{item.sourceName} · 当前页面播放</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl" aria-label="关闭播放器">×</button>
        </header>

        {loading ? (
          <div className="flex aspect-video items-center justify-center bg-black text-sm text-white/65">正在获取播放地址…</div>
        ) : error ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-black px-5 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <button type="button" className="rounded-full bg-white/10 px-4 py-2 text-sm" onClick={onClose}>返回首页</button>
          </div>
        ) : currentUrl ? (
          <div className="aspect-video w-full bg-black">
            <PlayerShell
              key={`${item.sourceKey}:${item.vodId}`}
              url={currentUrl}
              title={item.name}
              adFilter={adFilter}
              autoplayNext={autoplayNext}
              autoSkipSegments={autoSkipSegments}
              pendingStart={pendingStart}
              onPendingStart={setPendingStart}
              episodeKey={`${item.sourceKey}:${item.vodId}:${episodeIndex}`}
              nextUrl={episodes[episodeIndex + 1]}
              nextEpisodeKey={episodes[episodeIndex + 1] ? `${item.sourceKey}:${item.vodId}:${episodeIndex + 1}` : undefined}
              hasPrevEpisode={episodeIndex > 0}
              hasNextEpisode={episodeIndex < episodes.length - 1}
              onPrevEpisode={() => goEpisode(episodeIndex - 1)}
              onNextEpisode={() => goEpisode(episodeIndex + 1)}
              getRestorePosition={getRestorePosition}
              onTimeUpdate={handleProgress}
              onPause={handleProgress}
              onEnded={handleEnded}
            />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center bg-black text-sm text-white/65">该影片暂时没有可播放剧集</div>
        )}

        {showAutoNext ? (
          <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-white/5 px-4 py-3 text-xs text-white/80" role="status">
            <span>即将自动播放下一集</span>
            <div className="flex shrink-0 gap-2">
              <button type="button" className="rounded-lg bg-amber-400 px-3 py-2 font-semibold text-black" onClick={() => goEpisode(episodeIndex + 1)}>立即播放</button>
              <button type="button" className="rounded-lg bg-white/10 px-3 py-2 text-white" onClick={cancelAutoNext}>取消</button>
            </div>
          </div>
        ) : null}
        {episodes.length > 1 && (
          <div className="max-h-36 overflow-y-auto border-t border-white/10 p-3 sm:p-4">
            <div className="mb-2 text-xs text-white/55">选集 · {episodes.length} 集</div>
            <div className="flex flex-wrap gap-2">
              {episodes.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-pressed={episodeIndex === index}
                  onClick={() => goEpisode(index)}
                  className={`min-h-9 min-w-12 rounded-lg px-3 text-xs ${episodeIndex === index ? 'bg-amber-400 text-black' : 'bg-white/10 text-white'}`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
