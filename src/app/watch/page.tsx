'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
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
import { suggestDownloadFilename } from '@/lib/download-saver';
import { useAuth } from '@/components/auth';
import { resolveSource, useAppStore } from '@/lib/store';
import { qualityKey } from '@/lib/quality';
import { requestNativeFullscreenWithFallback, type NativeFullscreenVideo } from '@/lib/player-fullscreen';
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
import type { VideoEpisode } from '@/lib/types';
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
function formatWatchTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function WatchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isIpadEditionPlayback = pathname === '/ipad-edition/watch';
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
  const [watchClock, setWatchClock] = useState({ position: 0, duration: 0 });
  const watchClockRef = useRef(watchClock);
  watchClockRef.current = watchClock;
  const [watchRate, setWatchRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayerPanel, setShowPlayerPanel] = useState(false);
  const [showAutoNext, setShowAutoNext] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [skipPanelOpen, setSkipPanelOpen] = useState(false);
  const playerApiRef = useRef<PlayerSkipApi | null>(null);
  const fullscreenFallbackCleanupRef = useRef<(() => void) | null>(null);
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const watchShellRef = useRef<HTMLDivElement | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const scrubResetTimerRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubbingPosition, setScrubbingPosition] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [sheetMaxHeight] = useState<number | undefined>(undefined);

  // 优先使用本次播放 URL 传入的数据源地址，普通源仍以本机配置为准。
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
    if (localSource) return localSource;
    return resolveSource(store, sourceKey, {
      url: suppliedSourceUrl || undefined,
      detail: searchParams.get('detail') || undefined,
    });
  }, [store, sourceKey, suppliedSourceUrl, searchParams]);
  const sourceUrlInvalid = Boolean(source?.url && !validateSourceUrl(source.url));
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
  const isMovie = /电影|movie|film/i.test(mediaType);
  const hasEpisodeNavigation = episodes.length > 1;
  const isReadableTitle = (value: string) => Boolean(value.trim()) && !/^[a-z0-9_-]+$/i.test(value.trim());
  const detailTitle = detailQuery.data?.videoInfo?.title?.trim() || '';
  const videoTitle = isReadableTitle(titleParam) ? titleParam.trim() : isReadableTitle(detailTitle) ? detailTitle : '未知视频';
  const displayedPosition = scrubbingPosition ?? watchClock.position;
  const progressPercent = watchClock.duration > 0
    ? Math.min(100, Math.max(0, (displayedPosition / watchClock.duration) * 100))
    : 0;

  useEffect(() => {
    if (!hasEpisodeNavigation && sidebarTab === 'episodes') setSidebarTab('sources');
  }, [hasEpisodeNavigation, sidebarTab]);

  // Playback controls remain visible while paused and auto-hide three seconds after playback starts.
  // Any pointer/touch interaction reveals them; media events, not button clicks, own playback state.
  useEffect(() => {
    const shell = watchShellRef.current;
    const frame = playerFrameRef.current;
    if (!shell || !frame) return;
    let video: HTMLVideoElement | null = null;
    let controlsWereHiddenAtPointerStart = false;
    const recordControlsDebug = (event: string, detail = '') => {
      try {
        const entries = JSON.parse(shell.dataset.controlsHideDebug || '[]') as string[];
        entries.push(`${Math.round(performance.now())}:${event}${detail ? ':' + detail : ''}`);
        shell.dataset.controlsHideDebug = JSON.stringify(entries.slice(-24));
      } catch {
        shell.dataset.controlsHideDebug = event;
      }
    };
    const clearHideTimer = (reason = 'unspecified') => {
      const timer = controlsHideTimerRef.current;
      const hadTimer = timer !== null;
      if (timer !== null) window.clearTimeout(timer);
      recordControlsDebug('timer-clear', `${reason},hadTimer=${hadTimer}`);
      controlsHideTimerRef.current = null;
    };
    const showControls = () => {
      shell.classList.remove('cinema-controls-hidden');
      setControlsVisible(true);
    };
    const hideControls = () => {
      // Always inspect the currently mounted media element when the deadline fires.
      const activeVideo = frame.querySelector('video');
      recordControlsDebug('timer-fire', activeVideo
        ? `paused=${activeVideo.paused},ended=${activeVideo.ended},time=${activeVideo.currentTime.toFixed(2)}`
        : 'video-missing');
      if (scrubbingRef.current || !activeVideo || activeVideo.paused || activeVideo.ended) {
        controlsHideTimerRef.current = null;
        return;
      }
      shell.classList.add('cinema-controls-hidden');
      setControlsVisible(false);
      controlsHideTimerRef.current = null;
    };
    const revealControls = (event?: Event) => {
      // Capture the pre-interaction state before showControls removes the class.
      // Otherwise the following synthesized click cannot tell that this press
      // began while controls were hidden and may immediately dismiss them again.
      const wereHiddenBeforeInteraction = shell.classList.contains('cinema-controls-hidden');
      clearHideTimer('reveal');
      showControls();
      const target = event?.target;
      // Only a physical press starts scrubbing. A synthesized click fires after
      // pointerup/touchend; treating it as a new scrub can leave the visibility
      // lock stuck because no second release event follows that click.
      const startsScrubbing = event?.type === 'pointerdown' || event?.type === 'touchstart';
      if (startsScrubbing) {
        controlsWereHiddenAtPointerStart = controlsWereHiddenAtPointerStart || wereHiddenBeforeInteraction;
      }
      if (startsScrubbing && target instanceof Element && target.closest('.watch-cinema-progress')) {
        // A new drag supersedes the delayed cleanup from the previous drag.
        // Otherwise an old 1.2s timer can clear the preview during this gesture.
        if (scrubResetTimerRef.current !== null) {
          window.clearTimeout(scrubResetTimerRef.current);
          scrubResetTimerRef.current = null;
        }
        scrubbingRef.current = true;
        setIsScrubbing(true);
        return;
      }
      if (video && !video.paused && !video.ended) {
        recordControlsDebug('timer-schedule', `reveal,paused=${video.paused},ended=${video.ended},time=${video.currentTime.toFixed(2)},delay=3000`);
        controlsHideTimerRef.current = window.setTimeout(hideControls, 3000);
      }
    };
    const resetScrubbing = () => {
      scrubbingRef.current = false;
      controlsWereHiddenAtPointerStart = false;
      if (scrubResetTimerRef.current !== null) {
        window.clearTimeout(scrubResetTimerRef.current);
        scrubResetTimerRef.current = null;
      }
      setIsScrubbing(false);
      setScrubbingPosition(null);
    };
    const keepControlsVisible = () => {
      clearHideTimer();
      showControls();
    };
    const onMediaReset = () => {
      // Source/episode changes can reuse the same HTMLVideoElement. In that
      // case MutationObserver sees no replacement, so reset the scrub lifecycle
      // from native loadstart/emptied events instead of carrying a stale drag lock.
      resetScrubbing();
      keepControlsVisible();
    };
    const scheduleHide = () => {
      clearHideTimer('reschedule');
      if (scrubbingRef.current) {
        showControls();
        return;
      }
      if (!video || video.paused || video.ended) {
        recordControlsDebug('timer-skip', !video ? 'video-missing' : `paused=${video.paused},ended=${video.ended}`);
        showControls();
        return;
      }
      recordControlsDebug('timer-schedule', `playback,paused=${video.paused},ended=${video.ended},time=${video.currentTime.toFixed(2)},delay=3000`);
      controlsHideTimerRef.current = window.setTimeout(hideControls, 3000);
    };
    const onPlay = () => { showControls(); scheduleHide(); };
    const onPause = () => { resetScrubbing(); keepControlsVisible(); };
    const onEnded = () => { resetScrubbing(); keepControlsVisible(); };
    const onLoadStart = onMediaReset;
    const onWaiting = keepControlsVisible;
    const onError = () => { resetScrubbing(); keepControlsVisible(); };
    const detachVideo = () => {
      if (!video) return;
      video.removeEventListener('play', onPlay);
      video.removeEventListener('playing', scheduleHide);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('loadstart', onLoadStart);
      video.removeEventListener('emptied', onLoadStart);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onWaiting);
      video.removeEventListener('error', onError);
      video = null;
    };
    const attachVideo = () => {
      const next = frame.querySelector('video');
      if (next === video) return;
      detachVideo();
      if (!next) return;

      // A replaced media element starts a new control lifecycle (source recovery,
      // episode switch, or PlayerShell remount). Never carry a stale scrub lock,
      // preview timer, or "hidden at pointer start" flag into the new element.
      clearHideTimer('media-element-replaced');
      if (scrubResetTimerRef.current !== null) {
        window.clearTimeout(scrubResetTimerRef.current);
        scrubResetTimerRef.current = null;
      }
      scrubbingRef.current = false;
      controlsWereHiddenAtPointerStart = false;
      setIsScrubbing(false);
      setScrubbingPosition(null);
      showControls();

      video = next;
      video.addEventListener('play', onPlay);
      video.addEventListener('playing', scheduleHide);
      video.addEventListener('pause', onPause);
      video.addEventListener('ended', onEnded);
      video.addEventListener('loadstart', onLoadStart);
      video.addEventListener('emptied', onLoadStart);
      video.addEventListener('waiting', onWaiting);
      video.addEventListener('stalled', onWaiting);
      video.addEventListener('error', onError);
      if (!video.paused && !video.ended) scheduleHide();
      else keepControlsVisible();
    };
    // Hover/mouse tracking can emit pointermove while the player is already visible.
    // Do not keep restarting the hide deadline for incidental movement; once hidden,
    // the first real pointer movement restores the controls.
    const onPointerMove = () => {
      if (shell.classList.contains('cinema-controls-hidden')) {
        revealControls();
      } else if (video && !video.paused && !video.ended) {
        // Pointer movement is the last user activity signal on desktop. Restart
        // the deadline so controls disappear three seconds after that activity.
        scheduleHide();
      }
    };
    const onShellClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Buttons, tabs, links and form controls keep their normal click behavior.
      // A tap on the empty video surface is an explicit, immediate dismiss action.
      const clickedControl = target.closest(
        'button, a, input, select, textarea, [role="button"], [role="tab"], label'
      );
      if (clickedControl) {
        controlsWereHiddenAtPointerStart = false;
        revealControls(event);
        return;
      }
      if (scrubbingRef.current) return;
      if (controlsWereHiddenAtPointerStart || shell.classList.contains('cinema-controls-hidden')) {
        controlsWereHiddenAtPointerStart = false;
        if (video && !video.paused && !video.ended) scheduleHide();
        else keepControlsVisible();
        return;
      }
      controlsWereHiddenAtPointerStart = false;
      // Paused/ended/not-yet-mounted media must keep its controls available.
      // Only active playback supports the tap-to-dismiss gesture.
      if (!video || video.paused || video.ended) {
        keepControlsVisible();
        return;
      }
      clearHideTimer('manual-dismiss');
      shell.classList.add('cinema-controls-hidden');
      setControlsVisible(false);
    };
    const endScrubbing = () => {
      if (!scrubbingRef.current) return;
      scrubbingRef.current = false;
      setIsScrubbing(false);
      if (scrubResetTimerRef.current !== null) window.clearTimeout(scrubResetTimerRef.current);
      scrubResetTimerRef.current = window.setTimeout(() => {
        setScrubbingPosition(null);
        scrubResetTimerRef.current = null;
      }, 1200);
      if (video && !video.paused && !video.ended) scheduleHide();
      else keepControlsVisible();
    };
    shell.addEventListener('pointerdown', revealControls, true);
    shell.addEventListener('pointermove', onPointerMove, { passive: true });
    shell.addEventListener('touchstart', revealControls, { passive: true, capture: true });
    shell.addEventListener('click', onShellClick, true);
    shell.addEventListener('keydown', revealControls, true);
    window.addEventListener('pointerup', endScrubbing, true);
    window.addEventListener('pointercancel', endScrubbing, true);
    window.addEventListener('touchend', endScrubbing, true);
    window.addEventListener('touchcancel', endScrubbing, true);
    const observer = new MutationObserver(attachVideo);
    observer.observe(frame, { childList: true, subtree: true });
    attachVideo();
    return () => {
      clearHideTimer();
      if (scrubResetTimerRef.current !== null) window.clearTimeout(scrubResetTimerRef.current);
      observer.disconnect();
      detachVideo();
      shell.removeEventListener('pointerdown', revealControls, true);
      shell.removeEventListener('pointermove', onPointerMove);
      shell.removeEventListener('touchstart', revealControls, true);
      shell.removeEventListener('click', onShellClick, true);
      shell.removeEventListener('keydown', revealControls, true);
      window.removeEventListener('pointerup', endScrubbing, true);
      window.removeEventListener('pointercancel', endScrubbing, true);
      window.removeEventListener('touchend', endScrubbing, true);
      window.removeEventListener('touchcancel', endScrubbing, true);
      scrubbingRef.current = false;
    };
  }, [verified]);

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
  }, [episodes, indexParam, directUrl]);  // The cinema transport icon is driven by the real media element state,
  // not by the button click. MutationObserver handles PlayerShell's async mount
  // and any video element replacement during source recovery.
  useEffect(() => {
    const frame = playerFrameRef.current;
    if (!frame) return;
    let video: HTMLVideoElement | null = null;
    const sync = () => {
      setIsPlaying(Boolean(video && !video.paused && !video.ended));
      const rate = video?.playbackRate;
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) setWatchRate(rate);
    };
    const detach = () => {
      if (!video) return;
      video.removeEventListener('play', sync);
      video.removeEventListener('playing', sync);
      video.removeEventListener('pause', sync);
      video.removeEventListener('ended', sync);
      video.removeEventListener('ratechange', sync);
      video = null;
      setIsPlaying(false);
      setWatchRate(1);
    };
    const attach = () => {
      const next = frame.querySelector('video');
      if (next === video) return;
      detach();
      if (!next) return;
      video = next;
      video.addEventListener('play', sync);
      video.addEventListener('playing', sync);
      video.addEventListener('pause', sync);
      video.addEventListener('ended', sync);
      video.addEventListener('ratechange', sync);
      sync();
    };
    const observer = new MutationObserver(attach);
    observer.observe(frame, { childList: true, subtree: true });
    attach();
    return () => {
      observer.disconnect();
      detach();
    };
  }, [sourceKey, vodId, indexParam, directUrl]);

  const currentIndex = useMemo(() => {
    if (episodes.length > 0) {
      return Math.min(
        Math.max(indexParam, 0),
        episodes.length - 1
      );
    }
    return indexParam;
  }, [episodes, indexParam]);
  const currentEpisodeKey = `${sourceKey}:${vodId}:${currentIndex}`;
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
      const nextUrl = episodes[index] || directUrl;
      if (!nextUrl) return;
      // Flush the outgoing episode before the URL identity changes. Later pause
      // events may belong to the new source lifecycle and must not overwrite it.
      const outgoingProgressId = vodId || currentUrl;
      const outgoingPosition = playerApiRef.current?.getCurrentTime() ?? watchClockRef.current.position;
      const outgoingDuration = playerApiRef.current?.getDuration() ?? watchClockRef.current.duration;
      if (outgoingProgressId && Number.isFinite(outgoingPosition) && outgoingPosition > 0) {
        saveProgress(sourceKey, outgoingProgressId, currentIndex, outgoingPosition, outgoingDuration).catch(() => {});
        updateHistoryProgress(sourceKey, outgoingProgressId, outgoingPosition, outgoingDuration).catch(() => {});
      }
      // A new episode starts with a fresh timeline; never leave the previous
      // episode's clock or scrub preview visible while the new media loads.
      setWatchClock({ position: 0, duration: 0 });
      setScrubbingPosition(null);
      setIsScrubbing(false);
      scrubbingRef.current = false;
      if (scrubResetTimerRef.current !== null) {
        window.clearTimeout(scrubResetTimerRef.current);
        scrubResetTimerRef.current = null;
      }
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('index', String(index));
      sp.set('url', nextUrl);
      sp.delete('position');
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, episodes, directUrl, vodId, currentUrl, sourceKey, currentIndex]
  );
  // 进度恢复优先级：URL position 参数 > IndexedDB 记录
  const getRestorePosition = useCallback(async () => {
    const urlPos =
      parseInt(searchParams.get('position') || '0', 10) || 0;
    if (urlPos > 0) return urlPos;
    const progressId = vodId || currentUrl;
    if (!progressId) return 0;
    const entry = await db.progress.get(
      progressKeyOf(sourceKey, progressId, currentIndex)
    );
    if (entry?.position && entry.position > 5) return entry.position;
    // 兼容旧版或进度表缺失：从本机观看历史恢复最后一次有效位置。
    const history = await db.history.get(`${sourceKey}_${progressId}`);
    // History stores only one last-played episode position for the whole title.
    // It is safe to restore only when that record belongs to this same episode.
    return history && history.episodeIndex === currentIndex && history.playbackPosition > 5
      ? history.playbackPosition
      : 0;
  }, [searchParams, sourceKey, vodId, currentUrl, currentIndex]);
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
    (position: number, duration: number, eventEpisodeKey?: string) => {
      // Media events can arrive from the previous source during a route/episode
      // transition. Never attribute an old clock position to the newly selected episode.
      if (eventEpisodeKey && eventEpisodeKey !== currentEpisodeKey) return;
      const progressId = vodId || currentUrl;
      if (!progressId) return;
      saveProgress(
        sourceKey,
        progressId,
        currentIndex,
        position,
        duration
      ).catch(() => {});
      updateHistoryProgress(
        sourceKey,
        progressId,
        position,
        duration
      ).catch(() => {});
    },
    [sourceKey, vodId, currentIndex, currentUrl, currentEpisodeKey]
  );
  // 自动连播的 800ms 延迟切集要在卸载时取消，避免离开页面后跳转
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (autoNextTimer.current) {
        clearTimeout(autoNextTimer.current);
      }
      fullscreenFallbackCleanupRef.current?.();
      fullscreenFallbackCleanupRef.current = null;
    },
    []
  );
  const cancelAutoNext = useCallback(() => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    autoNextTimer.current = null;
    setShowAutoNext(false);
  }, []);
  const handleEnded = useCallback((eventEpisodeKey?: string) => {
    if (eventEpisodeKey && eventEpisodeKey !== currentEpisodeKey) return;
    const progressId = vodId || currentUrl;
    if (progressId) clearProgress(sourceKey, progressId, currentIndex).catch(() => {});
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
    currentEpisodeKey,
    episodes.length,
    goEpisode,
    sourceKey,
    vodId,
    currentUrl,
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
    <div ref={watchShellRef} className={`min-h-screen flex flex-col netflix-watch-shell${isIpadEditionPlayback ? ' ipad-edition-watch' : ''}${controlsVisible ? '' : ' cinema-controls-hidden'}${isScrubbing ? ' cinema-controls-scrubbing' : ''}`}>
      <header className="watch-topbar netflix-watch-overlay-topbar">
        <div className="watch-topbar-inner">
          <div className="watch-topbar-left">
            <button type="button" className="cinema-glass-control cinema-close-control" aria-label="关闭播放器" onClick={() => { if (window.history.length > 1) router.back(); else router.push('/'); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
            </button>
          </div>
          <div className="watch-topbar-right">
            <button type="button" className="cinema-glass-control" aria-label="全屏播放" title="全屏播放" onClick={() => {
              const video = playerFrameRef.current?.querySelector('video') as (NativeFullscreenVideo & {
                webkitExitFullscreen?: () => void;
              }) | null;
              if (video?.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
                video.webkitExitFullscreen();
                return;
              }
              if (document.fullscreenElement) {
                void document.exitFullscreen().catch(() => toast('退出全屏失败，请重试', 'info'));
                return;
              }
              const frame = playerFrameRef.current;
              const enterWebFullscreen = () => {
                if (frame?.requestFullscreen) {
                  void frame.requestFullscreen().catch(() => toast('当前浏览器无法进入全屏', 'info'));
                } else {
                  toast('当前浏览器不支持全屏播放', 'info');
                }
              };
              fullscreenFallbackCleanupRef.current?.();
              fullscreenFallbackCleanupRef.current = null;
              if (video) {
                // iOS may expose webkitEnterFullscreen but silently fail to enter.
                // Reuse the tested timeout fallback instead of returning too early.
                fullscreenFallbackCleanupRef.current = requestNativeFullscreenWithFallback(
                  video,
                  enterWebFullscreen,
                );
              } else {
                enterWebFullscreen();
              }
            }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
            </button>
            <button type="button" className="cinema-glass-control" aria-label="投屏" title="投屏 / AirPlay" onClick={() => {
              const video = playerFrameRef.current?.querySelector('video') as (HTMLVideoElement & {
                webkitShowPlaybackTargetPicker?: () => void;
                remote?: { prompt?: () => Promise<void> };
              }) | null;
              if (!video) {
                toast('视频尚未准备好，暂时无法投屏', 'info');
                return;
              }
              if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
                video.webkitShowPlaybackTargetPicker();
                return;
              }
              if (typeof video.remote?.prompt === 'function') {
                void video.remote.prompt().catch(() => toast('未能打开投屏设备选择器', 'info'));
                return;
              }
              toast('当前浏览器不支持 AirPlay 或远程播放投屏', 'info');
            }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v12H3zM8 20l4-4 4 4M8 9h8" /></svg>
            </button>
            <button type="button" className="cinema-glass-control cinema-utility-control" aria-expanded={showPlayerPanel} aria-controls="netflix-watch-utility-panel" aria-label="选集与换源" onClick={() => setShowPlayerPanel((value) => !value)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6 py-4 netflix-watch" data-content-type={hasEpisodeNavigation ? "series" : "movie"}>
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
                  episodeKey={currentEpisodeKey}
                  sourceKey={sourceKey}
                  resourceKey={currentEpisodeKey}
                  onPlaybackSample={(sample) => useAppStore.getState().recordPlaybackSample(sample)}
                  onRequestSwitchSource={() => {
                    const video = playerFrameRef.current?.querySelector('video');
                    if (video && Number.isFinite(video.currentTime)) {
                      setWatchClock((current) => ({ ...current, position: video.currentTime }));
                    }
                    setSwitchOpen(true);
                  }}
                  nextUrl={currentIndex + 1 < episodes.length ? episodes[currentIndex + 1] : undefined}
                  nextEpisodeKey={currentIndex + 1 < episodes.length ? `${sourceKey}:${vodId}:${currentIndex + 1}` : undefined}
                  getRestorePosition={getRestorePosition}
                  onTimeUpdate={(position, duration, eventEpisodeKey) => {
                    if (eventEpisodeKey && eventEpisodeKey !== currentEpisodeKey) return;
                    // Render the timeline from every native media timeupdate (typically
                    // several times per second) so the scrubber never visibly jumps.
                    setWatchClock({ position, duration });
                  }}
                  onProgressSave={handleProgress}
                  onPause={(position, duration, eventEpisodeKey) => {
                    if (eventEpisodeKey && eventEpisodeKey !== currentEpisodeKey) return;
                    setWatchClock({ position, duration });
                    handleProgress(position, duration, eventEpisodeKey);
                  }}
                  onEnded={handleEnded}
                  onPlaybackConfirmed={(evidence) => {
                    let host = '';
                    try { host = new URL(currentUrl).hostname.toLowerCase(); } catch { return; }
                    void fetch('/api/resource-collector/playback-sample', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ host, ...evidence }),
                      keepalive: true,
                    }).catch(() => undefined);
                  }}
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
            <div className="cinema-center-controls" aria-label="播放控制">
              <button type="button" className="cinema-glass-control cinema-skip-control" aria-label="后退 10 秒" onClick={() => {
                const video = playerFrameRef.current?.querySelector('video');
                if (video) video.currentTime = Math.max(0, video.currentTime - 10);
              }}>
                <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 8L8 16l10 8M10 17a17 17 0 1 0 8-8" /><text x="24" y="29">10</text></svg>
              </button>
              <button
                type="button"
                className="cinema-glass-control cinema-play-control"
                aria-label={isPlaying ? '暂停' : '播放'}
                aria-pressed={isPlaying}
                title={isPlaying ? '暂停' : '播放'}
                data-playback-state={isPlaying ? 'playing' : 'paused'}
                onClick={() => {
                  const video = playerFrameRef.current?.querySelector('video');
                  if (!video) return;
                  if (video.paused || video.ended) {
                    void video.play().then(() => {
                      // A source recovery may replace the media element while play() is pending.
                      // Never let a stale Promise overwrite the state of the newly mounted video.
                      if (playerFrameRef.current?.querySelector('video') === video) {
                        setIsPlaying(!video.paused && !video.ended);
                      }
                    }).catch(() => {
                      if (playerFrameRef.current?.querySelector('video') === video) {
                        setIsPlaying(false);
                      }
                    });
                  } else {
                    video.pause();
                    setIsPlaying(false);
                  }
                }}
              >
                {isPlaying
                  ? <svg className="cinema-play-icon cinema-play-icon--pause" viewBox="0 0 48 48" aria-hidden="true"><path d="M16 11v26M32 11v26" /></svg>
                  : <svg className="cinema-play-icon cinema-play-icon--play" viewBox="0 0 48 48" aria-hidden="true"><path d="M17 10.8c0-1.2 1.3-1.9 2.3-1.2l17.2 11.7a1.5 1.5 0 0 1 0 2.5L19.3 35.5c-1 .7-2.3 0-2.3-1.2V10.8Z" /></svg>}
              </button>
              <button type="button" className="cinema-glass-control cinema-skip-control" aria-label="前进 10 秒" onClick={() => {
                const video = playerFrameRef.current?.querySelector('video');
                if (video) video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
              }}>
                <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M30 8l10 8-10 8M38 17a17 17 0 1 1-8-8" /><text x="24" y="29">10</text></svg>
              </button>
            </div>

            <div className="netflix-title-row">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-semibold text-content truncate">{videoTitle}</h1>
                <p className="text-xs sm:text-sm text-muted mt-1">
                  {source.name} · {hasEpisodeNavigation ? `第 ${currentIndex + 1} / ${episodes.length} 集` : isMovie ? '电影' : '单集内容'}
                </p>
              </div>

            </div>

            <section className="watch-cinema-info" aria-label="影片信息">
              <div className="watch-cinema-playback">
                <div className="watch-cinema-time">
                  <span>{formatWatchTime(displayedPosition)}</span>
                  <span>{watchClock.duration > 0 ? `-${formatWatchTime(Math.max(0, watchClock.duration - displayedPosition))}` : '--:--'}</span>
                </div>
                <input
                  className="watch-cinema-progress"
                  type="range"
                  min={0}
                  max={Math.max(1, watchClock.duration)}
                  step={1}
                  value={Math.min(displayedPosition, watchClock.duration || displayedPosition)}
                  style={{ '--watch-progress': `${progressPercent}%` } as CSSProperties}
                  aria-label="播放进度"
                  aria-valuetext={`${formatWatchTime(displayedPosition)} / ${formatWatchTime(watchClock.duration)}`}
                  onChange={(event) => {
                    // Dragging updates the thumb/preview only. Seeking the media
                    // on every input event causes repeated HLS flushes and stutter.
                    setScrubbingPosition(Number(event.target.value));
                  }}
                  onPointerDown={(event) => {
                    // Keep the drag stream attached to the range input even if
                    // the finger leaves its narrow visual track.
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerUp={(event) => {
                    // Pointer Events cover modern iPad Safari touch and desktop
                    // mouse. Do not also seek from touchend/blur: those events
                    // can follow the same gesture and issue duplicate seeks.
                    playerApiRef.current?.seek(Number(event.currentTarget.value));
                  }}
                  onKeyUp={(event) => {
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                      playerApiRef.current?.seek(Number(event.currentTarget.value));
                    }
                  }}
                  disabled={!watchClock.duration}
                />
                {isScrubbing && <output className="watch-cinema-scrub-preview" aria-live="off">{formatWatchTime(displayedPosition)}</output>}
                <button
                  type="button"
                  className="watch-cinema-rate"
                  aria-label={`播放速度 ${watchRate} 倍`}
                  title="切换播放速度"
                  onClick={() => {
                    const rates = [1, 1.25, 1.5, 2, 0.75];
                    const current = playerApiRef.current?.getPlaybackRate() ?? watchRate;
                    const next = rates[(rates.indexOf(current) + 1 + rates.length) % rates.length];
                    playerApiRef.current?.setPlaybackRate(next);
                    setWatchRate(next);
                  }}
                >{watchRate}×</button>
              </div>
            </section>

            <div className="netflix-watch-tools">
              {hasEpisodeNavigation && <><button className="btn-ghost btn-sm" disabled={currentIndex <= 0} onClick={() => goEpisode(currentIndex - 1)}>上一集</button>
              <button className="btn-ghost btn-sm" disabled={currentIndex >= episodes.length - 1} onClick={() => goEpisode(currentIndex + 1)}>下一集</button></>}
              <button className="btn-ghost btn-sm" onClick={() => {
                if (!currentUrl) return;
                const downloadTitle = `${videoTitle}${hasEpisodeNavigation ? ` 第${currentIndex + 1}集` : ''}`;
                if (/\.m3u8(?:$|[?#])/i.test(currentUrl)) {
                  // HLS is parsed and transmuxed by the existing task engine; MP4
                  // here means the output container, never a renamed playlist.
                  enqueueDownload({ url: currentUrl, title: downloadTitle, format: 'MP4' });
                  return;
                }
                // A non-HLS URL is a direct media/file URL, not an M3U8 playlist.
                // Do not enqueue it into the playlist parser. Cross-origin download
                // attributes are advisory only, so open the actual URL as a fallback.
                const anchor = document.createElement('a');
                anchor.href = currentUrl;
                anchor.download = suggestDownloadFilename(downloadTitle, currentUrl);
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                toast('已打开直链。若 Safari 未保存文件，请在打开的视频页面使用分享菜单保存；跨域站点不保证网页可强制下载。', 'info');
              }}>下载本集</button>
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

          {showPlayerPanel && isIpadEditionPlayback && (
            <button
              type="button"
              className="netflix-watch-panel-scrim"
              aria-label="关闭播放内容面板"
              onClick={() => setShowPlayerPanel(false)}
            />
          )}
          <aside id="netflix-watch-utility-panel" className={cn('netflix-watch-sidebar netflix-watch-utility-panel', showPlayerPanel && 'is-open')} aria-hidden={!showPlayerPanel}>
            {isIpadEditionPlayback && (
              <div className="netflix-watch-panel-heading">
                <strong>播放内容</strong>
                <button type="button" aria-label="关闭选集与换源面板" onClick={() => setShowPlayerPanel(false)}>×</button>
              </div>
            )}
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
                      <EpisodeRow key={realIndex} index={realIndex} active={realIndex === currentIndex} episode={detailQuery.data?.episodeItems?.[realIndex]} onClick={() => goEpisode(realIndex)} />
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
                  <button className="btn-primary btn-sm" onClick={() => setSwitchOpen(true)}>换源</button>
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
            <div className="netflix-sidebar-footer">
              <span>快捷键：空格播放/暂停 · ←/→ 快退/快进 · F 全屏</span>
              <span>Alt + ←/→ 切换集数</span>
            </div>
          </aside>
        </div>
      </main>
      <AIFloatingBall inlineMode showFab={false} />
      {switchOpen && (
        <SwitchSourceModal
          currentTitle={videoTitle}
          currentSourceKey={sourceKey}
          currentVodId={vodId}
          currentIndex={currentIndex}
          getCurrentPosition={() => {
            const video = playerFrameRef.current?.querySelector('video');
            return video && Number.isFinite(video.currentTime) ? video.currentTime : watchClock.position;
          }}
          onClose={() => setSwitchOpen(false)}
        />
      )}
    </div>
  );
}
type EpisodeRowProps = {
  index: number;
  active: boolean;
  episode?: VideoEpisode;
  onClick: () => void;
};

function EpisodeRow({ index, active, episode, onClick }: EpisodeRowProps) {
  const title = episode?.episodeName?.trim() || episode?.title?.trim() || `第 ${index + 1} 集`;
  const subtitle = [episode?.description?.trim(), episode?.duration?.trim()].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors',
        active ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/[0.06]'
      )}
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      aria-label={`播放${title}`}
    >
      <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-white/10">
        {episode?.image ? (
          <SmartImage url={episode.image} mode="direct" alt={title} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-white/55">
            {String(index + 1).padStart(2, '0')}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-content">{title}</span>
        {subtitle && <span className="mt-1 block truncate text-xs text-faint">{subtitle}</span>}
      </span>
      <span aria-hidden="true" className={cn('shrink-0 text-sm', active ? 'text-white' : 'text-white/45')}>
        {active ? '正在播放' : '▶'}
      </span>
    </button>
  );
}


function BackButton() {
  const router = useRouter();
  return (
    <button
      className="watch-topbar-back"
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
