'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import FridayOrb from '@/components/friday/FridayOrb';
import AIFloatingBall from '@/components/AIFloatingBall';
import { api } from '@/lib/client-api';
// 播放器（artplayer + hls.js）按需加载：拆出独立 chunk，不占首屏 First Load JS
const PlayerShell = dynamic(() => import('@/components/player-shell').then((m) => m.PlayerShell), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  ),
});
import { EmptyState, LoadingState, Spinner } from '@/components/states';
import { SwitchSourceModal } from '@/components/switch-source';
import { SkipMarkPanel } from '@/components/skip-mark-panel';
import { skipMarkKey, validateSegment, type SkipSegment } from '@/lib/skip-marks';
import type { PlayerSkipApi } from '@/components/player-shell';
import { useToast } from '@/components/toast';
import { enqueueDownload } from '@/components/download-manager';
import { Icon } from '@/components/icon';
import { useAuth } from '@/components/auth';
import { resolveSource, useAppStore } from '@/lib/store';
import { qualityKey } from '@/lib/quality';
import {
  clearProgress,
  progressKeyOf,
  saveProgress,
  updateHistoryProgress,
  upsertHistory,
  db,
} from '@/lib/db';
import { buildWatchUrl, cn, validateSourceUrl } from '@/lib/utils';
import { SmartImage } from '@/components/smart-image';
/**
 * 播放页（唯一入口，替代旧版 watch.html → player.html 跳转链）。
 * 状态全部由 URL 驱动：/watch?source=xx&id=..&index=..&title=..
 * 集数列表由服务端详情接口获取；进度与历史走 IndexedDB。
 *
 * Friday CMS 特殊处理：
 * 优先使用搜索结果传递的 sourceUrl，避免本地旧配置覆盖本次搜索地址。
 */
export default function WatchPage() {
  return (
    <Suspense>
      <WatchContent />
    </Suspense>
  );
}
function WatchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const store = useAppStore();
  const { verified } = useAuth();
  const { toast } = useToast();
  const sourceKey = searchParams.get('source') || '';
  const vodId = searchParams.get('id') || '';
  const directUrl = searchParams.get('url') || '';
  const titleParam = searchParams.get('title') || '';
  const indexParam = parseInt(searchParams.get('index') || '0', 10) || 0;
  const [reversed, setReversed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'episodes' | 'sources' | 'details'>('episodes');
  const [showAutoNext, setShowAutoNext] = useState(false);
  const recentHistory = useLiveQuery(
    () => db.history.orderBy('timestamp').reverse().limit(8).toArray(),
    [sourceKey, vodId]
  );
  // 全量观看索引用于推荐去重；不把已看过的影片重复包装成新推荐。
  const watchedHistory = useLiveQuery(() => db.history.toArray(), []);
  const sortedContinueHistory = useMemo(() => (recentHistory ?? [])
    .filter((item) => !(item.sourceKey === sourceKey && item.vodId === vodId))
    .map((item) => {
      const percent = item.duration > 0 ? Math.min(100, Math.max(0, Math.round(item.playbackPosition / item.duration * 100))) : 0;
      const hasNextEpisode = item.totalEpisodes > 0 && item.episodeIndex < item.totalEpisodes - 1;
      const unfinished = hasNextEpisode || (item.duration > 0 && item.playbackPosition / item.duration < 0.95);
      return { item, percent, unfinished };
    })
    .sort((a, b) => Number(b.unfinished) - Number(a.unfinished) || b.item.timestamp - a.item.timestamp)
    .slice(0, 6), [recentHistory, sourceKey, vodId]);

  const [switchOpen, setSwitchOpen] = useState(false);
  const [skipPanelOpen, setSkipPanelOpen] = useState(false);
  // 播放器对外暴露的精确时间读取接口（「记录当前」用），随播放器卸载置空
  const playerApiRef = useRef<PlayerSkipApi | null>(null);
  // 播放框：小屏「跳过标记」抽屉要按它的底边算剩余高度，避免压住画面
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const [sheetMaxHeight, setSheetMaxHeight] = useState<number | undefined>(undefined);
  /**
   * 数据源解析：
   * 1. Friday CMS 如果 URL 携带 sourceUrl，优先使用本次搜索传来的地址。
   * 2. 普通数据源仍然优先使用本地配置。
   * 3. 本地配置不存在时，才使用 URL 携带的 fallback 地址。
   *
   * 注意：Friday CMS 不继承本地旧配置中的 detail 地址，
   * 避免详情接口请求被导向旧站点。
   */
  const suppliedSourceUrl = (searchParams.get('sourceUrl') || '').trim();
  const localSource = resolveSource(store, sourceKey);
  const source = useMemo(() => {
    if (sourceKey === 'friday-cms' && suppliedSourceUrl) {
      return {
        ...(localSource ?? {}),
        key: sourceKey,
        name: localSource?.name || 'Friday CMS',
        url: suppliedSourceUrl,
        detail: undefined,
      };
    }
    if (localSource) {
      return localSource;
    }
    return resolveSource(store, sourceKey, {
      url: suppliedSourceUrl || undefined,
      detail: searchParams.get('detail') || undefined,
    });
  }, [store, sourceKey, suppliedSourceUrl, searchParams]);
  // 来源地址安全校验：无效地址不发起详情请求。
  const sourceUrlInvalid = Boolean(
    source?.url && !validateSourceUrl(source.url)
  );
  // 详情查询：无 id（纯直连链接）时跳过
  const detailQuery = useQuery({
    queryKey: ['detail', sourceKey, vodId, source?.url],
    queryFn: ({ signal }) => api.detail(vodId, source!, signal),
    enabled: Boolean(source && !sourceUrlInvalid && vodId && verified),
    staleTime: 5 * 60_000,
  });
  const episodes = useMemo(
    () => detailQuery.data?.episodes ?? [],
    [detailQuery.data]
  );
  const mediaType = detailQuery.data?.videoInfo?.typeName ?? '';
  const isMovie = /电影|movie|film/i.test(mediaType) || episodes.length === 1;
  const hasEpisodeNavigation = episodes.length > 1;
  const videoTitle =
    titleParam || detailQuery.data?.videoInfo?.title || '未知视频';
  // 真实相关内容：使用用户已启用的点播源按当前片名搜索，不生成虚构推荐。
  const recommendationSources = useMemo(
    () => store.customAPIs.filter((item) => store.selectedKeys.includes(item.key) && (!item.isAdult || store.adFilter)),
    [store.customAPIs, store.selectedKeys, store.adFilter]
  );
  const relatedQuery = useQuery({
    queryKey: ['watch-related', videoTitle, recommendationSources.map((item) => item.key).join(',')],
    queryFn: () => api.search(videoTitle, recommendationSources, store.adFilter),
    enabled: verified && videoTitle !== '未知视频' && recommendationSources.length > 0,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const relatedItems = useMemo(() => {
    const history = watchedHistory ?? [];
    const watchedIds = new Set(history.map((item) => `${item.sourceKey}:${item.vodId}`));
    const normalize = (value?: string) => (value ?? '').trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
    const watchedTitles = new Set(history.map((item) => normalize(item.title)).filter(Boolean));
    const currentInfo = detailQuery.data?.videoInfo;
    const recentGenreCounts = new Map<string, number>();
    history.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 8).forEach((entry, index) => {
      const genre = normalize(entry.typeName);
      if (genre) recentGenreCounts.set(genre, (recentGenreCounts.get(genre) ?? 0) + (8 - index));
    });
    const seen = new Set<string>();
    const candidates = (relatedQuery.data?.list ?? [])
      .filter((item) => !(item.sourceKey === sourceKey && item.vodId === vodId))
      .filter((item) => !watchedIds.has(`${item.sourceKey}:${item.vodId}`))
      .filter((item) => !watchedTitles.has(normalize(item.name)))
      .filter((item) => {
        const title = normalize(item.name);
        if (!title || seen.has(title)) return false;
        seen.add(title);
        return true;
      });
    const score = (item: (typeof candidates)[number]) => {
      const genre = normalize(item.typeName);
      return (currentInfo?.typeName && genre && normalize(currentInfo.typeName) === genre ? 6 : 0) +
        (genre ? (recentGenreCounts.get(genre) ?? 0) : 0) +
        (currentInfo?.year && item.year && currentInfo.year === item.year ? 2 : 0) +
        (currentInfo?.area && item.area && normalize(currentInfo.area) === normalize(item.area) ? 1 : 0);
    };
    return candidates.map((item, index) => ({ item, index, score: score(item) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 8).map(({ item }) => item);
  }, [relatedQuery.data, sourceKey, vodId, watchedHistory, detailQuery.data?.videoInfo]);
  // 当前播放地址：优先取剧集列表中的当前集，其次直连 URL 参数
  const currentUrl = useMemo(() => {
    if (episodes.length > 0) {
      const idx = Math.min(
        Math.max(indexParam, 0),
        episodes.length - 1
      );
      return episodes[idx] || directUrl;
    }
    return directUrl;
  }, [episodes, indexParam, directUrl]);
  const currentIndex = useMemo(() => {
    if (episodes.length > 0) {
      return Math.min(
        Math.max(indexParam, 0),
        episodes.length - 1
      );
    }
    return indexParam;
  }, [episodes, indexParam]);
  // 跳过片段按剧名记忆：换集不变，换源到同名资源也能命中。
  // 标题缺失（直连链接）时退回 source:vodId，至少保证本源本片可用。
  const skipMarkFallback = `${sourceKey}:${vodId || currentUrl}`;
  const markKey = useMemo(
    () => skipMarkKey(videoTitle, skipMarkFallback),
    [videoTitle, skipMarkFallback]
  );
  const skipMark = store.skipMarks[markKey];
  const markedCount = skipMark?.segments.length ?? 0;
  // 中段两步态的起点：页面层持有，面板按钮与 Shift+S/E 共用同一份状态
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  // 换集清空中段两步态：起点属于上一集，不能和新集的位置拼成区间
  useEffect(() => {
    setPendingStart(null);
  }, [sourceKey, vodId, currentIndex]);
  const goEpisode = useCallback(
    (index: number) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('index', String(index));
      sp.set('url', episodes[index] || directUrl);
      sp.delete('position');
      router.replace(`/watch?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams, episodes, directUrl]
  );
  // 进度恢复优先级：URL position 参数 > IndexedDB 记录
  const getRestorePosition = useCallback(async () => {
    const urlPos =
      parseInt(searchParams.get('position') || '0', 10) || 0;
    if (urlPos > 0) return urlPos;
    if (!vodId) return 0;
    const entry = await db.progress.get(
      progressKeyOf(sourceKey, vodId, currentIndex)
    );
    if (entry?.position && entry.position > 5) return entry.position;
    // 兼容旧版或进度表缺失：从本机观看历史恢复最后一次有效位置。
    const history = await db.history.get(`${sourceKey}_${vodId}`);
    return history && history.playbackPosition > 5
      ? history.playbackPosition
      : 0;
  }, [searchParams, sourceKey, vodId, currentIndex]);
  // 写入观看历史（进入页面即记录，进度后续增量更新）
  useEffect(() => {
    if (!verified || !sourceKey || !currentUrl) return;
    const timer = setTimeout(() => {
      upsertHistory({
        sourceKey,
        sourceUrl: source?.url,
        vodId: vodId || currentUrl,
        title: videoTitle,
        pic: detailQuery.data?.videoInfo?.cover,
        typeName: detailQuery.data?.videoInfo?.typeName,
        year: detailQuery.data?.videoInfo?.year,
        area: detailQuery.data?.videoInfo?.area,
        episodeIndex: currentIndex,
        totalEpisodes: episodes.length,
        playbackPosition: 0,
        duration: 0,
        timestamp: Date.now(),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, sourceKey, vodId, currentIndex, videoTitle, currentUrl, detailQuery.data?.videoInfo?.cover, detailQuery.data?.videoInfo?.typeName, detailQuery.data?.videoInfo?.year, detailQuery.data?.videoInfo?.area]);
  // 播放中与暂停时的进度落盘逻辑一致，共用同一回调
  const handleProgress = useCallback(
    (position: number, duration: number) => {
      if (vodId) {
        saveProgress(
          sourceKey,
          vodId,
          currentIndex,
          position,
          duration
        ).catch(() => {});
        updateHistoryProgress(
          sourceKey,
          vodId || currentUrl,
          position,
          duration
        ).catch(() => {});
      }
    },
    [sourceKey, vodId, currentIndex, currentUrl]
  );
  // 自动连播的 800ms 延迟切集要在卸载时取消，避免离开页面后跳转
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (autoNextTimer.current) {
        clearTimeout(autoNextTimer.current);
      }
    },
    []
  );
  const cancelAutoNext = useCallback(() => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    autoNextTimer.current = null;
    setShowAutoNext(false);
  }, []);
  const handleEnded = useCallback(() => {
    if (vodId) {
      clearProgress(sourceKey, vodId, currentIndex).catch(() => {});
    }
    if (store.autoplayNext && currentIndex < episodes.length - 1) {
      setShowAutoNext(true);
      autoNextTimer.current = setTimeout(() => {
        setShowAutoNext(false);
        goEpisode(currentIndex + 1);
      }, 8000);
    }
  }, [
    store.autoplayNext,
    currentIndex,
    episodes.length,
    goEpisode,
    sourceKey,
    vodId,
  ]);
  useEffect(() => {
    if (!store.autoplayNext) cancelAutoNext();
  }, [store.autoplayNext, cancelAutoNext]);
  useEffect(() => {
    cancelAutoNext();
  }, [currentIndex, cancelAutoNext]);
  // 快捷键（Shift+I/O/S/E）记录片段：校验后写入
  const handleRecordSegment = useCallback(
    (segment: SkipSegment) => {
      const duration = playerApiRef.current?.getDuration() ?? 0;
      const existing =
        useAppStore.getState().skipMarks[markKey]?.segments ?? [];
      const error = validateSegment(segment, duration, existing);
      if (error) {
        toast(error, 'error');
        return;
      }
      useAppStore.getState().setSkipMark(markKey, [
        ...existing,
        segment,
      ]);
      const label =
        segment.type === 'opening'
          ? '片头结束'
          : segment.type === 'ending'
            ? '片尾开始'
            : '中段片段';
      // 中段命中时的表现取决于全局「自动跳过片段」，记完就说清楚，避免"标了却没反应"
      const hint =
        segment.type === 'middle'
          ? useAppStore.getState().autoSkipSegments
            ? '，命中时将自动跳过'
            : '，命中时显示跳过按钮'
          : '';
      toast(`已记录${label}${hint}`, 'success');
    },
    [markKey, toast]
  );
  // Alt+←/→ 集数切换快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        goEpisode(currentIndex - 1);
      } else if (
        e.key === 'ArrowRight' &&
        currentIndex < episodes.length - 1
      ) {
        e.preventDefault();
        goEpisode(currentIndex + 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [currentIndex, episodes.length, goEpisode]);
  const orderedEpisodes = reversed
    ? [...episodes].map((_, i) => episodes.length - 1 - i)
    : episodes.map((_, i) => i);
  if (!verified) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-faint text-sm">等待访问验证...</p>
      </div>
    );
  }
  if (!source) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-content font-medium mb-2">
            点播源不存在
          </h1>
          <p className="text-sm text-muted mb-4">
            该视频来自点播源「{sourceKey}」，但它可能已被删除。请在设置中重新添加后重试。
          </p>
          <Link href="/" className="btn-primary">
            返回首页
          </Link>
        </div>
      </div>
    );
  }
  if (sourceUrlInvalid) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-content font-medium mb-2">
            数据源地址无效
          </h1>
          <p className="text-sm text-muted mb-4">
            当前视频携带的数据源地址未通过安全校验。为避免请求不安全的地址，播放页已停止加载。
          </p>
          <Link href="/" className="btn-primary">
            返回首页
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen flex flex-col">
      <header className="glass-toolbar sticky top-0 z-40 !rounded-none border-x-0 border-t-0 px-0">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <BackButton />
          <HomeButton />
          <div className="min-w-0">
            <h1 className="text-sm font-medium text-content truncate">
              {videoTitle}
            </h1>
            <p className="text-xs text-faint">
              {source.name}
              {hasEpisodeNavigation ? ` · 第 ${currentIndex + 1}/${episodes.length} 集` : isMovie ? ' · 电影' : ''}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <FridayPlayerAssistantButton />
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6 py-4 netflix-watch">
        <div className="netflix-watch-grid">
          <section className="netflix-watch-primary min-w-0">
            <div
              ref={playerFrameRef}
              className="netflix-player-frame aspect-video bg-black overflow-hidden"
            >
              {currentUrl ? (
                <PlayerShell
                  url={currentUrl}
                  title={videoTitle}
                  adFilter={store.adFilter}
                  autoplayNext={store.autoplayNext}
                  skipMark={skipMark}
                  autoSkipSegments={store.autoSkipSegments}
                  pendingStart={pendingStart}
                  onPendingStart={setPendingStart}
                  onPlayerApi={(api) => { playerApiRef.current = api; }}
                  onRecordSegment={handleRecordSegment}
                  episodeKey={`${sourceKey}:${vodId}:${currentIndex}`}
                  nextUrl={currentIndex + 1 < episodes.length ? episodes[currentIndex + 1] : undefined}
                  nextEpisodeKey={currentIndex + 1 < episodes.length ? `${sourceKey}:${vodId}:${currentIndex + 1}` : undefined}
                  getRestorePosition={getRestorePosition}
                  onTimeUpdate={handleProgress}
                  onPause={handleProgress}
                  onEnded={handleEnded}
                  hasPrevEpisode={currentIndex > 0}
                  hasNextEpisode={episodes.length > 0 && currentIndex < episodes.length - 1}
                  onPrevEpisode={() => goEpisode(currentIndex - 1)}
                  onNextEpisode={() => goEpisode(currentIndex + 1)}
                  onQuality={(height) => {
                    if (!sourceKey || !vodId) return;
                    const key = qualityKey(sourceKey, vodId);
                    const store = useAppStore.getState();
                    const previous = store.qualityMap[key];
                    const previousCount = previous?.from === 'play' ? previous.playbackSampleCount ?? 1 : 0;
                    store.setQuality({ [key]: { height, from: 'play', timestamp: Date.now() } });
                    const current = useAppStore.getState().qualityMap[key];
                    if (current?.from !== 'play') return;
                    const sampleCount = current.playbackSampleCount ?? 1;
                    if (sampleCount <= previousCount) return;
                    window.dispatchEvent(new CustomEvent('friday-player-quality', {
                      detail: {
                        candidateId: `${sourceKey}:${vodId}`,
                        sourceKey,
                        vodId,
                        height,
                        playbackSampleCount: sampleCount,
                        playbackMinHeight: current.playbackMinHeight ?? height,
                        playbackMaxHeight: current.playbackMaxHeight ?? height,
                        observedAt: new Date(current.lastPlaybackSampleAt ?? Date.now()).toISOString(),
                      },
                    }));
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {detailQuery.isLoading ? <Spinner size="lg" /> : (
                    <p className="text-faint text-sm">
                      {detailQuery.isError ? '视频加载失败，请尝试其他资源' : '无可用播放地址'}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="netflix-title-row">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-semibold text-content truncate">{videoTitle}</h1>
                <p className="text-xs sm:text-sm text-muted mt-1">
                  {source.name} · {hasEpisodeNavigation ? `第 ${currentIndex + 1} / ${episodes.length} 集` : isMovie ? '电影' : '正在播放'}
                </p>
              </div>

            </div>

            <div className="netflix-below-player">
              <div className="netflix-section-heading">
                <div>
                  <h2>继续观看</h2>
                  <p>根据本机观看记录，接着上次的进度继续</p>
                </div>
                <Link href="/me" className="text-sm text-muted hover:text-content">全部观看历史 →</Link>
              </div>
              <div className="netflix-history-rail">
                {sortedContinueHistory.map(({ item, percent, unfinished }) => {
                  const href = buildWatchUrl({ sourceKey: item.sourceKey, vodId: item.vodId, index: item.episodeIndex, title: item.title, sourceUrl: item.sourceUrl });
                  return (
                    <Link key={`${item.sourceKey}:${item.vodId}`} href={href} className="netflix-history-card">
                      <div className="netflix-history-art">
                        {item.pic ? <SmartImage url={item.pic} mode="direct" alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-chip" />}
                        <span className="netflix-history-play"><span aria-hidden="true">▶</span></span>
                      </div>
                      <div className="netflix-history-meta">
                        <strong>{item.title}</strong>
                        <span>{item.totalEpisodes > 0 ? `第 ${item.episodeIndex + 1} / ${item.totalEpisodes} 集` : '继续观看'}{!unfinished ? ' · 已看完' : ''}</span>
                        <div className="netflix-history-progress"><i style={{ width: `${percent}%` }} /></div>
                      </div>
                    </Link>
                  );
                })}
                {(!recentHistory || sortedContinueHistory.length === 0) && (
                  <p className="text-sm text-faint py-5">还没有其他观看记录，之后观看的影片会显示在这里。</p>
                )}
              </div>
            </div>

            <section className="netflix-related-section" aria-labelledby="netflix-related-heading">
              <div className="netflix-section-heading">
                <div>
                  <h2 id="netflix-related-heading">相关影片</h2>
                  <p>根据当前影片，从已启用的片源检索真实结果</p>
                </div>
              </div>
              {relatedQuery.isLoading || !watchedHistory ? (
                <p className="text-sm text-faint py-4">正在查找相关影片…</p>
              ) : relatedItems.length > 0 ? (
                <div className="netflix-related-rail">
                  {relatedItems.map((item) => (
                    <Link
                      key={`${item.sourceKey}:${item.vodId}`}
                      href={buildWatchUrl({ sourceKey: item.sourceKey, vodId: item.vodId, index: 0, title: item.name, sourceUrl: item.sourceUrl })}
                      className="netflix-related-card"
                    >
                      <div className="netflix-related-art">
                        {item.pic ? <SmartImage url={item.pic} mode="direct" alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-chip" />}
                      </div>
                      <strong>{item.name}</strong>
                      <span>{[item.year, item.typeName, item.remarks].filter(Boolean).join(' · ') || item.sourceName}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-faint py-4">
                  {recommendationSources.length === 0 ? '请先启用至少一个点播资源，才能检索相关影片。' : relatedQuery.isError ? '相关影片暂时无法获取。' : '当前片源没有返回其他相关影片。'}
                </p>
              )}
            </section>

            <div className="netflix-watch-tools">
              {hasEpisodeNavigation && <><button className="btn-ghost btn-sm" disabled={currentIndex <= 0} onClick={() => goEpisode(currentIndex - 1)}>上一集</button>
              <button className="btn-ghost btn-sm" disabled={currentIndex >= episodes.length - 1} onClick={() => goEpisode(currentIndex + 1)}>下一集</button></>}
              <button className="btn-ghost btn-sm" onClick={() => { if (currentUrl) enqueueDownload({ url: currentUrl, title: `${videoTitle}${hasEpisodeNavigation ? ` 第${currentIndex + 1}集` : ''}`, format: 'MP4' }); }}>下载本集</button>
              <button className={cn('btn-ghost btn-sm', skipPanelOpen && 'bg-chip text-content')} aria-expanded={skipPanelOpen} aria-haspopup="dialog" onClick={() => setSkipPanelOpen((v) => !v)}>
                跳过标记{markedCount > 0 ? ` (${markedCount})` : ''}
              </button>
              <label className="flex items-center gap-1.5 text-xs text-muted ml-auto cursor-pointer">
                <input type="checkbox" className="h-3.5 w-3.5 accent-[#2563eb]" checked={store.autoplayNext} onChange={(e) => store.updateSettings({ autoplayNext: e.target.checked })} />
                自动连播
              </label>
            </div>
            <SkipMarkPanel
              open={skipPanelOpen}
              onClose={() => setSkipPanelOpen(false)}
              markKey={markKey}
              pendingStart={pendingStart}
              onPendingStart={setPendingStart}
              mobileMaxHeight={sheetMaxHeight}
              getPlayerClock={() => {
                const api = playerApiRef.current;
                if (!api) return null;
                return { currentTime: api.getCurrentTime(), duration: api.getDuration(), seek: (s) => api.seek(s), pause: () => api.pause(), isPaused: () => api.isPaused() };
              }}
            />
          </section>

          <aside className="netflix-watch-sidebar">
            <div className="netflix-sidebar-tabs" role="tablist" aria-label="播放内容">
              {hasEpisodeNavigation && <button role="tab" aria-selected={sidebarTab === 'episodes'} className={sidebarTab === 'episodes' ? 'active' : ''} onClick={() => setSidebarTab('episodes')}>选集 <span>{episodes.length}</span></button>}
              <button role="tab" aria-selected={sidebarTab === 'sources'} className={sidebarTab === 'sources' ? 'active' : ''} onClick={() => setSidebarTab('sources')}>播放源</button>
              <button role="tab" aria-selected={sidebarTab === 'details'} className={sidebarTab === 'details' ? 'active' : ''} onClick={() => setSidebarTab('details')}>详情</button>
            </div>

            {sidebarTab === 'episodes' && hasEpisodeNavigation && (
              <div className="netflix-sidebar-content">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="text-sm text-content">正在播放 <strong className="text-content">第 {currentIndex + 1} 集</strong></div>
                  {episodes.length > 1 && <button className="btn-ghost btn-sm" onClick={() => setReversed((v) => !v)}>{reversed ? '正序 ↑' : '倒序 ↓'}</button>}
                </div>
                {episodes.length === 0 ? (
                  detailQuery.isLoading ? <LoadingState /> : <EmptyState variant="plain" title={detailQuery.isError ? '获取剧集失败' : '暂无剧集信息'} />
                ) : (
                  <div className="netflix-episode-list">
                    {orderedEpisodes.map((realIndex) => (
                      <EpisodeRow key={realIndex} index={realIndex} active={realIndex === currentIndex} onClick={() => goEpisode(realIndex)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {sidebarTab === 'sources' && (
              <div className="netflix-sidebar-content">
                <h3 className="text-sm font-semibold text-content mb-2">当前播放资源</h3>
                <div className="netflix-source-card">
                  <span className="netflix-source-indicator" />
                  <div className="min-w-0 flex-1"><strong>{source.name}</strong><span>当前使用 · 可切换其他可用资源</span></div>
                  <button className="btn-primary btn-sm" onClick={() => setSwitchOpen(true)}>切换</button>
                </div>
                <p className="text-xs text-faint mt-3">播放源切换会保留当前影片和集数，具体进度按现有换源逻辑处理。</p>
              </div>
            )}

            {sidebarTab === 'details' && (
              <div className="netflix-sidebar-content">
                <div className="netflix-detail-hero">
                  {detailQuery.data?.videoInfo?.cover && <SmartImage url={detailQuery.data.videoInfo.cover} mode="direct" alt="" className="w-24 aspect-[2/3] object-cover rounded-lg" />}
                  <div className="min-w-0"><h3 className="font-semibold text-content">{videoTitle}</h3><p className="text-xs text-muted mt-1">{source.name}</p><p className="text-xs text-faint mt-2">{episodes.length} 集</p></div>
                </div>
                <p className="text-sm text-muted leading-6 mt-4">{'影片详情可在影片资料页查看。'}</p>
              </div>
            )}

            {showAutoNext && currentIndex + 1 < episodes.length && (
              <div className="netflix-autonext-banner" role="status" aria-live="polite">
                <div className="min-w-0">
                  <strong>本集播放完毕</strong>
                  <span>即将播放第 {currentIndex + 2} 集</span>
                </div>
                <button className="btn-primary btn-sm" onClick={() => { cancelAutoNext(); goEpisode(currentIndex + 1); }}>立即播放</button>
                <button className="btn-ghost btn-sm" onClick={cancelAutoNext}>取消</button>
              </div>
            )}
            {currentIndex + 1 < episodes.length && (
              <div className="netflix-next-preview">
                <div className="netflix-section-kicker">接下来播放</div>
                <button className="netflix-next-card" onClick={() => goEpisode(currentIndex + 1)}>
                  <div className="netflix-next-thumb">
                    {detailQuery.data?.videoInfo?.cover ? <SmartImage url={detailQuery.data.videoInfo.cover} mode="direct" alt="" className="w-full h-full object-cover" /> : <span>EP {currentIndex + 2}</span>}
                    <span className="netflix-next-play"><span aria-hidden="true">▶</span></span>
                  </div>
                  <span className="min-w-0 flex-1 text-left"><strong>第 {currentIndex + 2} 集</strong><small>{videoTitle}</small></span>
                  <span aria-hidden="true">›</span>
                </button>
              </div>
            )}
            <div className="netflix-sidebar-footer">
              <span>快捷键：空格播放/暂停 · ←/→ 快退/快进 · F 全屏</span>
              <span>Alt + ←/→ 切换集数</span>
            </div>
          </aside>
        </div>
      </main>
      <AIFloatingBall showFab={false} inlineMode />
      {switchOpen && (
        <SwitchSourceModal
          currentTitle={videoTitle}
          currentSourceKey={sourceKey}
          currentVodId={vodId}
          currentIndex={currentIndex}
          onClose={() => setSwitchOpen(false)}
        />
      )}
    </div>
  );
}
/** 播放页专用圆球入口：放在页面工具栏，不覆盖播放器控制区。 */
function FridayPlayerAssistantButton() {
  const [voiceState, setVoiceState] = useState<'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'>('IDLE');
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    const onState = (event: Event) => {
      const state = (event as CustomEvent<{ state?: string }>).detail?.state;
      if (state === 'IDLE' || state === 'LISTENING' || state === 'THINKING' || state === 'SPEAKING') {
        setVoiceState(state);
      }
    };
    const onAudio = (event: Event) => {
      const level = (event as CustomEvent<{ level?: number }>).detail?.level;
      setAudioLevel(typeof level === 'number' && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0);
    };
    window.addEventListener('friday-home-voice-state', onState);
    window.addEventListener('friday-audio-level', onAudio);
    return () => {
      window.removeEventListener('friday-home-voice-state', onState);
      window.removeEventListener('friday-audio-level', onAudio);
    };
  }, []);

  const label = voiceState === 'LISTENING' ? 'Friday 正在聆听'
    : voiceState === 'THINKING' ? 'Friday 正在思考'
    : voiceState === 'SPEAKING' ? 'Friday 正在回答'
    : '打开 Friday 语音助手';

  return (
    <button
      type="button"
      className="h-10 w-10 shrink-0 rounded-full border border-line bg-surface/80 p-1 shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={label}
      title={label}
      aria-pressed={voiceState === 'LISTENING'}
      onClick={() => window.dispatchEvent(new CustomEvent('friday-home-orb-toggle'))}
    >
      <FridayOrb state={voiceState} audioLevel={audioLevel * 100} showHud={false} interactive={false} quality={0} ariaLabel="Friday 全息语音助手" />
    </button>
  );
}

/** 集数按钮：激活时自动滚动进可视区（长剧列表） */
function EpisodeRow({ index, active, onClick }: { index: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest' }); }, [active]);
  return (
    <button ref={ref} className={cn('netflix-episode-row', active && 'active')} onClick={onClick} aria-current={active ? 'true' : undefined}>
      <span className="netflix-episode-number">{index + 1}</span>
      <span className="min-w-0 flex-1 text-left"><strong>第 {index + 1} 集</strong><small>{active ? '正在播放' : '点击播放'}</small></span>
      {active ? <span className="text-accent" aria-hidden="true">●</span> : <span className="opacity-60" aria-hidden="true">▶</span>}
    </button>
  );
}
function BackButton() {
  const router = useRouter();
  return (
    <button
      className="p-2 -ml-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push('/');
        }
      }}
      aria-label="返回"
    >
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 19l-7-7 7-7"
        />
      </svg>
    </button>
  );
}
/** 首页按钮：直达首页，避免从外链进入时逐级 back */
function HomeButton() {
  return (
    <Link
      href="/"
      className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      aria-label="回首页"
      title="回首页"
    >
      <Icon name="home" className="w-5 h-5" />
    </Link>
  );
}
