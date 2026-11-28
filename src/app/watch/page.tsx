'use client';

import { matchesIpadMovieIdentity } from '@/lib/ipad-edition/movie-identity';
import { useAutomaticIpadPlaybackRecovery } from '@/lib/ipad-edition/useAutomaticPlaybackRecovery';
import { historyIdFor } from '@/lib/history-id';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { NativeCinemaFallback } from '@/components/native-cinema-fallback';
import { PlaybackErrorBoundary } from '@/components/playback-error-boundary';
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
import { bindWatchPlaybackState, skipWatchPlayback, toggleWatchPlayback } from '@/lib/watch-playback-state';
import { useFridayGlassPlayback } from '@/components/friday/FridayGlassProvider';
import { nextCinemaPlaybackRate, toggleCinemaPanel, shouldHoldCinemaControls } from '@/lib/cinema-v4-controls';
import { isCinemaPlaybackEventCurrent, isCinemaPlaybackTransitionPending, resolveCinemaBoundPlaybackUrl, selectCinemaPlaybackMedia, type CinemaPlaybackMedia } from '@/lib/cinema-playback-gate';
import { CinemaPlaybackActions } from '@/components/ipad-edition/CinemaPlaybackActions';
import { ClassicWatchTitle, ClassicWatchRateButton, ClassicWatchTools } from '@/components/watch/ClassicWatchControls';
import { usePlaybackEdition } from '@/components/watch/PlaybackEditionContext';
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
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
  const isIpadEditionPlayback = usePlaybackEdition() === 'cinema-v4';
  const store = useAppStore();
  const { verified } = useAuth();
  const { toast } = useToast();
  const sourceKey = searchParams.get('source') || '';
  const vodId = searchParams.get('id') || '';
  const directUrl = searchParams.get('url') || '';
  const titleParam = searchParams.get('title') || '';
  const indexParam = parseInt(searchParams.get('index') || '0', 10) || 0;
  const [runtimeRecovery, setRuntimeRecovery] = useState({ episodeKey: '', attempt: 0, position: 0 });
  const recoveryEpisodeKey = sourceKey + ':' + vodId + ':' + indexParam;
  const runtimeRecoveryRequested = runtimeRecovery.episodeKey === recoveryEpisodeKey && runtimeRecovery.attempt > 0;
  const [reversed, setReversed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'episodes' | 'sources' | 'details'>('episodes');
  const [watchClock, setWatchClock] = useState({ position: 0, duration: 0 });
  const watchClockRef = useRef(watchClock);
  watchClockRef.current = watchClock;
  const [watchRate, setWatchRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  useFridayGlassPlayback(isPlaying);
  const [showPlayerPanel, setShowPlayerPanel] = useState(false);
  const [cinemaPanel, setCinemaPanel] = useState<'audio' | 'subtitles' | 'quality' | 'diagnostics' | null>(null);
  const [cinemaLocked, setCinemaLocked] = useState(false);
  const [showAutoNext, setShowAutoNext] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [skipPanelOpen, setSkipPanelOpen] = useState(false);
  const playerApiRef = useRef<PlayerSkipApi | null>(null);
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenFallbackCleanupRef = useRef<(() => void) | null>(null);
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const [frame, setPlayerFrame] = useState<HTMLDivElement | null>(null);
  const attachPlayerFrame = useCallback((element: HTMLDivElement | null) => {
    playerFrameRef.current = element;
    setPlayerFrame(element);
  }, []);
  const watchShellRef = useRef<HTMLDivElement | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const scrubResetTimerRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const scrubbingPositionRef = useRef<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubbingPosition, setScrubbingPosition] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [sheetMaxHeight] = useState<number | undefined>(undefined);
  const requestWatchFullscreen = useCallback(() => {
    const video = playerFrameRef.current?.querySelector('video') as (NativeFullscreenVideo & {
      webkitExitFullscreen?: () => void;
    }) | null;
    if (video?.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
      try {
        video.webkitExitFullscreen();
        return;
      } catch {
        toast('退出系统全屏失败，请重试', 'info');
        return;
      }
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => toast('退出全屏失败，请重试', 'info'));
      return;
    }
    // The shell owns every custom overlay; full-screening only the video would
    // strand the center transport and bottom seek rail outside the top layer.
    const fullscreenTarget = watchShellRef.current;
    const enterWebFullscreen = () => {
      if (fullscreenTarget?.requestFullscreen) {
        void fullscreenTarget.requestFullscreen().catch(() => toast('当前浏览器无法进入全屏', 'info'));
      } else {
        toast('当前浏览器不支持全屏播放', 'info');
      }
    };
    fullscreenFallbackCleanupRef.current?.();
    fullscreenFallbackCleanupRef.current = null;
    if (video) {
      fullscreenFallbackCleanupRef.current = requestNativeFullscreenWithFallback(video, enterWebFullscreen);
    } else {
      enterWebFullscreen();
    }
  }, [toast]);

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
  const expectedMediaType = searchParams.get('identityType');
  const identityOriginalTitle = searchParams.get('identityOriginalTitle') || '';
  const identityYear = searchParams.get('identityYear') || '';
  const identityType = expectedMediaType === 'movie' || expectedMediaType === 'tv' ? expectedMediaType : undefined;
  const identityMismatch = isIpadEditionPlayback && Boolean(vodId && titleParam.trim() && detailQuery.data &&
    !matchesIpadMovieIdentity({
      titles: [titleParam, identityOriginalTitle], year: identityYear, type: identityType,
    }, {
      title: detailTitle,
      originalTitle: detailQuery.data.videoInfo?.originalTitle,
      years: [detailQuery.data.videoInfo?.year, searchParams.get('identitySearchYear') || undefined],
      typeNames: [detailQuery.data.videoInfo?.typeName],
    }));
  // No new intermediate UI: on mismatch, silently verify other enabled providers
  // before showing the existing fail-closed playback error.
  const requiresAutomaticRecovery = isIpadEditionPlayback && Boolean(vodId && titleParam.trim() && (
    identityMismatch || runtimeRecoveryRequested || (verified && (!source || detailQuery.isError || (detailQuery.data && episodes.length === 0)))
  ));
  const identityRecoveryPending = useAutomaticIpadPlaybackRecovery({
    enabled: Boolean(verified && requiresAutomaticRecovery),
    expected: { titles: [titleParam, identityOriginalTitle], year: identityYear, type: identityType },
    sourceKey, vodId, index: indexParam, query: searchParams.toString(), router,
    requestKey: runtimeRecoveryRequested ? String(runtimeRecovery.attempt) : 'initial',
    resumePosition: runtimeRecoveryRequested ? runtimeRecovery.position : undefined,
  });
  const videoTitle = isReadableTitle(titleParam) ? titleParam.trim() : isReadableTitle(detailTitle) ? detailTitle : '未知视频';
  const displayedPosition = scrubbingPosition ?? watchClock.position;
  const hasFiniteDuration = Number.isFinite(watchClock.duration) && watchClock.duration > 0;
  const safeDisplayedPosition = Number.isFinite(displayedPosition) && displayedPosition >= 0
    ? displayedPosition
    : 0;
  const progressPercent = hasFiniteDuration
    ? Math.min(100, Math.max(0, (safeDisplayedPosition / watchClock.duration) * 100))
    : 0;

  const skipCinemaPlayback = (delta: number) => {
    const video = playerFrameRef.current?.querySelector('video');
    if (!video || !skipWatchPlayback(video, delta)) return;
    // Paused media may not emit timeupdate after seeking. Sync the cinema
    // timeline immediately with the actual position chosen by the engine.
    const actualPosition = video.currentTime;
    if (Number.isFinite(actualPosition)) {
      if (scrubResetTimerRef.current !== null) {
        window.clearTimeout(scrubResetTimerRef.current);
        scrubResetTimerRef.current = null;
      }
      scrubbingPositionRef.current = null;
      setScrubbingPosition(null);
      setWatchClock((current) => ({ ...current, position: actualPosition }));
    }
  };

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
      if (!activeVideo || shouldHoldCinemaControls(scrubbingRef.current, shell.classList.contains('cinema-panel-open'), activeVideo.paused, activeVideo.ended)) {
        controlsHideTimerRef.current = null;
        return;
      }
      shell.classList.add('cinema-controls-hidden');
      setControlsVisible(false);
      controlsHideTimerRef.current = null;
    };
    const revealControls = (event?: Event) => {
      if (shell.classList.contains('cinema-v4-locked')) return;
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
        // iPad owns its pointer stream on the custom seek surface. Never enter
        // the native-input/global touch lifecycle for the same physical gesture.
        if (target.closest('.cinema-seek-surface')) return;
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
      scrubbingPositionRef.current = null;
    };
    const keepControlsVisible = (reason = 'keep-visible') => {
      clearHideTimer(reason);
      showControls();
    };
    const onMediaReset = (event: Event) => {
      lastProgressTime = null;
      const reason = `media-${event.type}`;
      // Source/episode changes can reuse the same HTMLVideoElement. In that
      // case MutationObserver sees no replacement, so reset the scrub lifecycle
      // from native loadstart/emptied events instead of carrying a stale drag lock.
      resetScrubbing();
      keepControlsVisible(reason);
    };
    const scheduleHide = () => {
      clearHideTimer('reschedule');
      if (scrubbingRef.current || shell.classList.contains('cinema-panel-open')) {
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
    const cancelPendingAutoNext = () => {
      if (autoNextTimer.current) window.clearTimeout(autoNextTimer.current);
      autoNextTimer.current = null;
      setShowAutoNext(false);
    };
    let lastProgressTime: number | null = null;
    const onTimeUpdateForControlVisibility = () => {
      if (!video || video.paused || video.ended || video.seeking || !Number.isFinite(video.currentTime)) return;
      const previous = lastProgressTime;
      lastProgressTime = video.currentTime;
      // Only resume a timer after a real timeline advance, never on repeated
      // timeupdate events with a frozen media clock. Do not reset the timer on
      // every frame or controls could remain visible indefinitely.
      if (previous !== null && video.currentTime > previous &&
          controlsHideTimerRef.current === null &&
          !shell.classList.contains('cinema-controls-hidden') &&
          !shell.classList.contains('cinema-panel-open') &&
          !scrubbingRef.current) {
        scheduleHide();
      }
    };
    const onPlay = () => {
      lastProgressTime = null;
      cancelPendingAutoNext();
      showControls();
      scheduleHide();
    };
    const onPause = () => {
      // Media events are queued: a delayed pause event can arrive after playback
      // has already resumed. Never let that stale event cancel the active hide timer.
      if (video && !video.paused && !video.ended) {
        recordControlsDebug('pause-ignored', 'media-still-playing');
        return;
      }
      resetScrubbing();
      keepControlsVisible('media-pause');
    };
    const onEnded = () => { resetScrubbing(); keepControlsVisible(); };
    const onSeeked = () => {
      cancelPendingAutoNext();
      // Safari/HLS can complete a seek asynchronously. Once the native media
      // confirms the destination, dismiss any temporary drag preview so it
      // cannot hide the real position for another 1.2 seconds.
      if (!video || scrubbingRef.current || !Number.isFinite(video.currentTime)) return;
      const actualPosition = video.currentTime;
      if (scrubResetTimerRef.current !== null) {
        window.clearTimeout(scrubResetTimerRef.current);
        scrubResetTimerRef.current = null;
      }
      scrubbingPositionRef.current = null;
      setScrubbingPosition(null);
      setWatchClock((current) => ({ ...current, position: actualPosition }));
    };
    const onLoadStart = onMediaReset;
    const onWaiting = (event: Event) => {
      // Buffering can fire many times without a resumed "playing" event.
      // Do not permanently suspend auto-hide: when media progresses again,
      // scheduleHide will re-arm the normal three-second deadline.
      keepControlsVisible(`media-${event.type}`);
    };
    const onError = () => { resetScrubbing(); keepControlsVisible('media-error'); };
    const detachVideo = () => {
      if (!video) return;
      video.removeEventListener('play', onPlay);
      video.removeEventListener('playing', scheduleHide);
      video.removeEventListener('timeupdate', onTimeUpdateForControlVisibility);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadstart', onLoadStart);
      video.removeEventListener('loadedmetadata', onLoadStart);
      video.removeEventListener('emptied', onLoadStart);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onWaiting);
      video.removeEventListener('error', onError);
      video = null;
      lastProgressTime = null;
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
      scrubbingPositionRef.current = null;
      controlsWereHiddenAtPointerStart = false;
      setIsScrubbing(false);
      setScrubbingPosition(null);
      showControls();

      video = next;
      video.addEventListener('play', onPlay);
      video.addEventListener('playing', scheduleHide);
      video.addEventListener('timeupdate', onTimeUpdateForControlVisibility);
      video.addEventListener('pause', onPause);
      video.addEventListener('ended', onEnded);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('loadstart', onLoadStart);
      video.addEventListener('loadedmetadata', onLoadStart);
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
      if (shell.classList.contains('cinema-v4-locked')) return;
      if (shell.classList.contains('cinema-controls-hidden')) {
        revealControls();
      } else if (video && !video.paused && !video.ended) {
        // Pointer movement is the last user activity signal on desktop. Restart
        // the deadline so controls disappear three seconds after that activity.
        scheduleHide();
      }
    };
    const onShellClick = (event: MouseEvent) => {
      if (shell.classList.contains('cinema-v4-locked')) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Buttons, tabs, links and form controls keep their normal click behavior.
      // A tap on the empty video surface is an explicit, immediate dismiss action.
      const clickedControl = target.closest(
        'button, a, input, select, textarea, [role="button"], [role="tab"], [role="slider"], label'
      );
      if (clickedControl) {
        controlsWereHiddenAtPointerStart = false;
        revealControls(event);
        return;
      }
      if (scrubbingRef.current || shell.classList.contains('cinema-panel-open')) return;
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
    const cancelScrubbing = () => {
      if (isIpadEditionPlayback || !scrubbingRef.current) return;
      resetScrubbing();
      if (video && !video.paused && !video.ended) scheduleHide();
      else keepControlsVisible();
    };
    const endScrubbing = () => {
      if (isIpadEditionPlayback || !scrubbingRef.current) return;
      // Commit at the window-level release, so lifting a finger outside the
      // slider still seeks and pointerup/touchend cannot issue duplicate seeks.
      const progressInput = shell.querySelector<HTMLInputElement>('.watch-cinema-progress');
      const finalPosition = scrubbingPositionRef.current ??
        (progressInput ? Number(progressInput.value) : Number.NaN);
      const api = playerApiRef.current;
      let actualPosition = Number.NaN;
      if (api && Number.isFinite(finalPosition)) {
        api.seek(finalPosition);
        actualPosition = api.getCurrentTime();
      }
      scrubbingRef.current = false;
      setIsScrubbing(false);
      if (scrubResetTimerRef.current !== null) window.clearTimeout(scrubResetTimerRef.current);
      if (Number.isFinite(actualPosition)) {
        // HLS and discontinuous seekable ranges can clamp the requested target.
        // Keep the preview aligned with the actual media clock until native events arrive.
        scrubbingPositionRef.current = actualPosition;
        setScrubbingPosition(actualPosition);
        setWatchClock((current) => ({ ...current, position: actualPosition }));
        scrubResetTimerRef.current = window.setTimeout(() => {
          setScrubbingPosition(null);
          scrubbingPositionRef.current = null;
          scrubResetTimerRef.current = null;
        }, 1200);
      } else {
        // No mounted player or rejected seek: never display an unplayable target.
        scrubbingPositionRef.current = null;
        setScrubbingPosition(null);
        scrubResetTimerRef.current = null;
      }
      if (video && !video.paused && !video.ended) scheduleHide();
      else keepControlsVisible();
    };
    shell.addEventListener('pointerdown', revealControls, true);
    shell.addEventListener('pointermove', onPointerMove, { passive: true });
    shell.addEventListener('touchstart', revealControls, { passive: true, capture: true });
    shell.addEventListener('click', onShellClick, true);
    shell.addEventListener('keydown', revealControls, true);
    window.addEventListener('pointerup', endScrubbing, true);
    window.addEventListener('pointercancel', cancelScrubbing, true);
    window.addEventListener('touchend', endScrubbing, true);
    window.addEventListener('touchcancel', cancelScrubbing, true);
    const observer = new MutationObserver(attachVideo);
    observer.observe(frame, { childList: true, subtree: true });
    attachVideo();
    return () => {
      clearHideTimer('effect-cleanup');
      if (scrubResetTimerRef.current !== null) window.clearTimeout(scrubResetTimerRef.current);
      observer.disconnect();
      detachVideo();
      shell.removeEventListener('pointerdown', revealControls, true);
      shell.removeEventListener('pointermove', onPointerMove);
      shell.removeEventListener('touchstart', revealControls, true);
      shell.removeEventListener('click', onShellClick, true);
      shell.removeEventListener('keydown', revealControls, true);
      window.removeEventListener('pointerup', endScrubbing, true);
      window.removeEventListener('pointercancel', cancelScrubbing, true);
      window.removeEventListener('touchend', endScrubbing, true);
      window.removeEventListener('touchcancel', cancelScrubbing, true);
      scrubbingRef.current = false;
      scrubbingPositionRef.current = null;
    };
  }, [verified]);

  // 当前播放地址：优先取剧集列表中的当前集，其次直连 URL 参数
  const currentUrl = useMemo(() => {
    if (identityMismatch || (isIpadEditionPlayback && vodId && titleParam.trim() && !detailQuery.data)) return '';
    if (episodes.length > 0) {
      const idx = Math.min(
        Math.max(indexParam, 0),
        episodes.length - 1
      );
      return episodes[idx] || directUrl;
    }
    return directUrl;
  }, [episodes, indexParam, directUrl, identityMismatch, isIpadEditionPlayback, vodId, titleParam, detailQuery.data]);  // Keep the cinema transport synchronized with the currently mounted media element.
  // The helper owns native listeners and rebinds safely when PlayerShell replaces video.
  useEffect(() => {
    if (!frame) return;
    return bindWatchPlaybackState(frame, ({ isPlaying, playbackRate }) => {
      setIsPlaying(isPlaying);
      if (playbackRate !== null && playbackRate > 0) setWatchRate(playbackRate);
    });
  }, [frame]);

  const currentIndex = useMemo(() => {
    if (episodes.length > 0) {
      return Math.min(
        Math.max(indexParam, 0),
        episodes.length - 1
      );
    }
    return indexParam;
  }, [episodes, indexParam]);

  const [cmsAssetBinding, setCmsAssetBinding] = useState<{
    sourceKey: string;
    vodId: string;
    episodeIndex: number;
    providerUrl: string;
    playbackUrl: string;
    resourceId: string;
    assetId: string;
    sha256: string;
    mediaType: 'mp4' | 'hls';
  } | null>(null);

  const cmsLookupKey = (sourceKey.startsWith('custom_') || sourceKey === 'friday-cms') &&
    sourceKey && vodId && source?.url && currentUrl && Number.isSafeInteger(currentIndex) && currentIndex >= 0
    ? JSON.stringify([sourceKey, vodId, currentIndex, source.url, currentUrl]) : null;
  const [settledCmsLookupKey, setSettledCmsLookupKey] = useState<string | null>(null);
  const cmsLookupPending = cmsLookupKey !== null && settledCmsLookupKey !== cmsLookupKey;
  // Source switching may require fetching the destination episode URL before
  // the CMS registry lookup can even begin; retain the Cinema player throughout.
  const cinemaMediaPending = isCinemaPlaybackTransitionPending({
    isCinema: isIpadEditionPlayback,
    cmsLookupPending,
    detailLoading: detailQuery.isLoading,
    currentUrl,
  });
  useEffect(() => {
    setCmsAssetBinding(null);
    setSettledCmsLookupKey(null);
    if (!cmsLookupKey || !source?.url) return;
    if (!globalThis.crypto?.subtle) { setSettledCmsLookupKey(cmsLookupKey); return; }
    let disposed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      if (!disposed) setSettledCmsLookupKey(cmsLookupKey);
    }, 2500);
    const lookup = async () => {
      try {
        const [providerUrlSha256, playbackUrlSha256] = await Promise.all([
          sha256Hex(source.url),
          sha256Hex(currentUrl),
        ]);
        if (controller.signal.aborted) return;
        const params = new URLSearchParams({
          sourceKey,
          vodId,
          episodeIndex: String(currentIndex),
          providerUrlSha256,
          playbackUrlSha256,
        });
        const response = await fetch(`/api/dolby-vision/cms-binding?${params.toString()}`, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json().catch(() => null);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
        const data = payload as Record<string, unknown>;
        if (typeof data.resourceId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.resourceId) ||
            typeof data.assetId !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(data.assetId) ||
            typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256) ||
            !((data.contentType === 'video/mp4' && data.mediaType === 'mp4') ||
              (data.contentType === 'application/vnd.apple.mpegurl' && data.mediaType === 'hls' &&
                data.graphId === data.assetId))) return;
        if (!controller.signal.aborted) {
          setCmsAssetBinding({
            sourceKey,
            vodId,
            episodeIndex: currentIndex,
            providerUrl: source.url,
            playbackUrl: currentUrl,
            resourceId: data.resourceId,
            assetId: data.assetId,
            sha256: data.sha256,
            mediaType: data.mediaType as 'mp4' | 'hls',
          });
        }
      } catch {
        // Ordinary CMS playback remains available when no exact trusted binding exists.
      } finally {
        clearTimeout(timeout);
        if (!disposed) setSettledCmsLookupKey(cmsLookupKey);
      }
    };
    void lookup();
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [cmsLookupKey, sourceKey, vodId, currentIndex, source?.url, currentUrl]);

  const activeCmsAssetBinding = cmsAssetBinding &&
    cmsAssetBinding.sourceKey === sourceKey &&
    cmsAssetBinding.vodId === vodId &&
    cmsAssetBinding.episodeIndex === currentIndex &&
    cmsAssetBinding.providerUrl === source?.url &&
    cmsAssetBinding.playbackUrl === currentUrl
    ? cmsAssetBinding
    : null;
  const playerUrl = resolveCinemaBoundPlaybackUrl(currentUrl, activeCmsAssetBinding);
  const currentEpisodeKey = `${sourceKey}:${vodId || currentUrl}:${currentIndex}`;
  // Preserve the mounted Cinema media element and its trusted asset identity
  // until the next CMS episode/source completes exact binding verification.
  const lastReadyCinemaMediaRef = useRef<CinemaPlaybackMedia | null>(null);
  const currentPlaybackMedia: CinemaPlaybackMedia = {
    url: playerUrl, episodeKey: currentEpisodeKey, sourceKey,
    mediaType: activeCmsAssetBinding?.mediaType,
    dolbyVisionAssetId: activeCmsAssetBinding?.assetId,
    dolbyVisionSourceKind: activeCmsAssetBinding ? 'registry' : directUrl ? 'direct' : (sourceKey.startsWith('custom_') || sourceKey === 'friday-cms') ? 'cms' : 'unknown',
    dolbyVisionSourceIdentity: activeCmsAssetBinding?.resourceId ?? (sourceKey || undefined),
  };
  useEffect(() => {
    if (!isIpadEditionPlayback || cinemaMediaPending || !currentUrl) return;
    lastReadyCinemaMediaRef.current = {
      url: playerUrl, episodeKey: currentEpisodeKey, sourceKey,
      mediaType: activeCmsAssetBinding?.mediaType,
      dolbyVisionAssetId: activeCmsAssetBinding?.assetId,
      dolbyVisionSourceKind: activeCmsAssetBinding ? 'registry' : directUrl ? 'direct' : (sourceKey.startsWith('custom_') || sourceKey === 'friday-cms') ? 'cms' : 'unknown',
      dolbyVisionSourceIdentity: activeCmsAssetBinding?.resourceId ?? (sourceKey || undefined),
    };
  }, [isIpadEditionPlayback, cinemaMediaPending, currentUrl, playerUrl, currentEpisodeKey, sourceKey, activeCmsAssetBinding, directUrl]);
  const cinemaMediaGate = selectCinemaPlaybackMedia({
    isCinema: isIpadEditionPlayback, cmsLookupPending: cinemaMediaPending,
    current: currentPlaybackMedia, lastReady: lastReadyCinemaMediaRef.current,
  });
  // Pause the outgoing source during verification without destroying the player.
  useEffect(() => {
    if (isIpadEditionPlayback && cinemaMediaPending && lastReadyCinemaMediaRef.current) {
      playerApiRef.current?.pause();
    }
  }, [isIpadEditionPlayback, cinemaMediaPending, cmsLookupKey]);
  const pendingEpisodeKeyRef = useRef<string | null>(null);
  const isCurrentPlaybackEvent = useCallback((eventEpisodeKey?: string) => {
    // During router.replace there is a short interval where the media element
    // may already emit events but React still holds the previous currentIndex.
    // Reject every media event until the rendered episode identity catches up.
    const pendingEpisodeKey = pendingEpisodeKeyRef.current;
    if (pendingEpisodeKey !== null) {
      if (currentEpisodeKey !== pendingEpisodeKey) return false;
      pendingEpisodeKeyRef.current = null;
    }
    return isCinemaPlaybackEventCurrent({
      isCinema: isIpadEditionPlayback,
      cmsLookupPending: cinemaMediaPending,
      holdingPrevious: cinemaMediaGate.holdingPrevious,
      currentEpisodeKey,
      eventEpisodeKey,
    });
  }, [currentEpisodeKey, isIpadEditionPlayback, cinemaMediaPending, cinemaMediaGate.holdingPrevious]);
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
  const previousPlaybackUrlRef = useRef(currentUrl);
  // 换集清空中段两步态：起点属于上一集，不能和新集的位置拼成区间
  useEffect(() => {
    setPendingStart(null);
    const mediaUrlChanged = previousPlaybackUrlRef.current !== currentUrl;
    previousPlaybackUrlRef.current = currentUrl;
    // A provider/episode identity can change while the exact media URL remains
    // the same. Preserve the live clock/play state in that case; only reset the
    // transport when the underlying media resource actually changes.
    if (!mediaUrlChanged) return;
    setIsPlaying(false);
    setWatchClock({ position: 0, duration: 0 });
    setScrubbingPosition(null);
    scrubbingPositionRef.current = null;
    setIsScrubbing(false);
    scrubbingRef.current = false;
    if (scrubResetTimerRef.current !== null) {
      window.clearTimeout(scrubResetTimerRef.current);
      scrubResetTimerRef.current = null;
    }
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
    watchShellRef.current?.classList.remove('cinema-controls-hidden');
    setControlsVisible(true);
  }, [sourceKey, vodId, currentIndex, currentUrl]);
  const goEpisode = useCallback(
    (index: number) => {
      const nextUrl = episodes[index] || directUrl;
      if (!nextUrl) return;
      // A manual episode change supersedes any pending autoplay-next countdown.
      if (autoNextTimer.current) window.clearTimeout(autoNextTimer.current);
      autoNextTimer.current = null;
      setShowAutoNext(false);
      pendingEpisodeKeyRef.current = `${sourceKey}:${vodId || nextUrl}:${index}`;
      // Flush the outgoing episode before the URL identity changes. Later pause
      // events may belong to the new source lifecycle and must not overwrite it.
      const outgoingProgressId = vodId || currentUrl;
      const outgoingVideo = playerFrameRef.current?.querySelector('video');
      const outgoingEnded = Boolean(outgoingVideo?.ended);
      const outgoingPosition = playerApiRef.current?.getCurrentTime() ?? watchClockRef.current.position;
      const outgoingDuration = playerApiRef.current?.getDuration() ?? watchClockRef.current.duration;
      if (!outgoingEnded && outgoingProgressId && Number.isFinite(outgoingPosition) && outgoingPosition > 0 &&
        Number.isFinite(outgoingDuration) && outgoingDuration > 0) {
        saveProgress(sourceKey, outgoingProgressId, currentIndex, outgoingPosition, outgoingDuration).catch(() => {});
        updateHistoryProgress(sourceKey, outgoingProgressId, outgoingPosition, outgoingDuration, currentIndex).catch(() => {});
      }
      // Reset the transport only when the underlying media URL changes.
      // Some providers map multiple episode identities to the same direct URL;
      // in that case the existing video keeps playing and its live clock is valid.
      if (nextUrl !== currentUrl) {
        if (controlsHideTimerRef.current !== null) {
          window.clearTimeout(controlsHideTimerRef.current);
          controlsHideTimerRef.current = null;
        }
        watchShellRef.current?.classList.remove('cinema-controls-hidden');
        setControlsVisible(true);
        setWatchClock({ position: 0, duration: 0 });
        setScrubbingPosition(null);
        scrubbingPositionRef.current = null;
        setIsScrubbing(false);
        scrubbingRef.current = false;
        if (scrubResetTimerRef.current !== null) {
          window.clearTimeout(scrubResetTimerRef.current);
          scrubResetTimerRef.current = null;
        }
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
    if (Number.isFinite(urlPos) && urlPos > 0) return urlPos;
    const progressId = vodId || currentUrl;
    if (!progressId) return 0;
    const entry = await db.progress.get(
      progressKeyOf(sourceKey, progressId, currentIndex)
    );
    if (entry && Number.isFinite(entry.position) && entry.position > 5) return entry.position;
    // 兼容旧版或进度表缺失：从本机观看历史恢复最后一次有效位置。
    const history = await db.history.get(historyIdFor(sourceKey, progressId));
    // History stores only one last-played episode position for the whole title.
    // It is safe to restore only when that record belongs to this same episode.
    return history && history.episodeIndex === currentIndex &&
      Number.isFinite(history.playbackPosition) && history.playbackPosition > 5
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
      if (!isCurrentPlaybackEvent(eventEpisodeKey)) return;
      if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration <= 0) return;
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
        duration,
        currentIndex
      ).catch(() => {});
    },
    [sourceKey, vodId, currentIndex, currentUrl, currentEpisodeKey, isCurrentPlaybackEvent]
  );
  // 自动连播的延迟切集要在卸载时取消，避免离开页面后跳转
  useEffect(
    () => () => {
      if (autoNextTimer.current) {
        clearTimeout(autoNextTimer.current);
        autoNextTimer.current = null;
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
    if (!isCurrentPlaybackEvent(eventEpisodeKey)) return;
    const progressId = vodId || currentUrl;
    if (progressId) {
      clearProgress(sourceKey, progressId, currentIndex).catch(() => {});
      // A completed episode must not fall back to the title-level history
      // position on the next visit after its per-episode progress is cleared.
      updateHistoryProgress(sourceKey, progressId, 0, 0, currentIndex).catch(() => {});
    }
    if (store.autoplayNext && currentIndex < episodes.length - 1) {
      if (autoNextTimer.current !== null) return;
      setShowAutoNext(true);
      autoNextTimer.current = setTimeout(() => {
        autoNextTimer.current = null;
        setShowAutoNext(false);
        goEpisode(currentIndex + 1);
      }, 8000);
    }
  }, [
    store.autoplayNext,
    currentIndex,
    currentEpisodeKey,
    isCurrentPlaybackEvent,
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
    // Switching provider/resource with the same episode index must also cancel
    // the old countdown; otherwise it can unexpectedly advance the new source.
    cancelAutoNext();
  }, [sourceKey, vodId, currentUrl, currentIndex, cancelAutoNext]);
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
  useEffect(() => {
    setCinemaPanel(null);
    setCinemaLocked(false);
  }, [currentUrl]);

  // Shared action: both UI variants use the same download semantics.
  const downloadCurrentEpisode = () => {
    if (!currentUrl) return;
    const downloadTitle = `${videoTitle}${hasEpisodeNavigation ? ` 第${currentIndex + 1}集` : ''}`;
    if (/\\.m3u8(?:$|[?#])/i.test(currentUrl)) {
      enqueueDownload({ url: currentUrl, title: downloadTitle, format: 'MP4' });
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = currentUrl;
    anchor.download = suggestDownloadFilename(downloadTitle, currentUrl);
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    toast('已打开直链。Safari 可通过分享菜单保存；跨域站点不保证自动下载。', 'info');
  };
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
  if (requiresAutomaticRecovery && identityRecoveryPending && !runtimeRecoveryRequested) {
    return <div className="min-h-screen flex items-center justify-center" role="status" aria-label="正在核验备用播放资源"><Spinner size="lg" /></div>;
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
  if (identityMismatch) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-content font-medium mb-2">影片资源不匹配</h1>
          <p className="text-sm text-muted mb-4">请求影片：{titleParam}；资源返回：{detailTitle || '未知'}。已停止播放，请重新选择正确资源。</p>
          <Link href="/ipad-edition" className="btn-primary">返回首页</Link>
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
    <div ref={watchShellRef} className={`min-h-screen flex flex-col netflix-watch-shell${isIpadEditionPlayback ? ' ipad-edition-watch' : ''}${controlsVisible ? '' : ' cinema-controls-hidden'}${isScrubbing ? ' cinema-controls-scrubbing' : ''}${cinemaPanel || showPlayerPanel ? ' cinema-panel-open' : ''}${cinemaLocked ? ' cinema-v4-locked' : ''}`}>
      <header className="watch-topbar netflix-watch-overlay-topbar">
        <div className="watch-topbar-inner">
          <div className="watch-topbar-left">
            <button type="button" data-friday-material="cinema" className="cinema-glass-control cinema-close-control" aria-label="关闭播放器" onClick={() => { if (window.history.length > 1) router.back(); else router.push(isIpadEditionPlayback ? '/ipad-edition' : '/'); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
            </button>
            {isIpadEditionPlayback && <span className="cinema-v4-heading" title={videoTitle}>{videoTitle}</span>}
          </div>
          <div className="watch-topbar-right">
            {!isIpadEditionPlayback && <button type="button" data-friday-material="cinema" className="cinema-glass-control" aria-label="全屏播放" title="全屏播放" onClick={requestWatchFullscreen}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
            </button>}
            <button type="button" data-friday-material="cinema" className={`cinema-glass-control${isIpadEditionPlayback ? " cinema-connect" : ""}`} aria-label="投屏" title={isIpadEditionPlayback ? "Cinema Connect · AirPlay / 投屏" : "投屏 / AirPlay"} onClick={() => {
              const video = playerFrameRef.current?.querySelector('video') as (HTMLVideoElement & {
                webkitShowPlaybackTargetPicker?: () => void;
                remote?: { prompt?: () => Promise<void> };
              }) | null;
              if (!video) {
                toast('视频尚未准备好，暂时无法投屏', 'info');
                return;
              }
              if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
                try {
                  video.webkitShowPlaybackTargetPicker();
                } catch {
                  toast('未能打开 AirPlay 设备选择器', 'info');
                }
                return;
              }
              if (typeof video.remote?.prompt === 'function') {
                void video.remote.prompt().catch(() => toast('未能打开投屏设备选择器', 'info'));
                return;
              }
              toast('当前浏览器不支持 AirPlay 或远程播放投屏', 'info');
            }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v12h-5M8 16H3V4M8 20l4-5 4 5z" /></svg>
            </button>
            {!isIpadEditionPlayback && <button type="button" data-friday-material="cinema" className="cinema-glass-control cinema-utility-control" aria-expanded={showPlayerPanel} aria-controls="netflix-watch-utility-panel" aria-label="选集与换源" onClick={() => { setCinemaPanel(null); setShowPlayerPanel((value) => !value); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
            </button>}
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6 py-4 netflix-watch" data-content-type={hasEpisodeNavigation ? "series" : "movie"}>
        <div className="netflix-watch-grid">
          <section className="netflix-watch-primary min-w-0">
            <div
              ref={attachPlayerFrame}
              className="netflix-player-frame aspect-video bg-black overflow-hidden"
            >
              {!cinemaMediaGate.showPlayer ? (
                <div className="w-full h-full flex items-center justify-center" role="status" aria-label="正在确认媒体地址"><Spinner size="lg" /></div>
              ) : (currentUrl || cinemaMediaGate.holdingPrevious) ? (
                <PlaybackErrorBoundary key={isIpadEditionPlayback ? "ipad-cinema" : playerUrl} resetKey={cinemaMediaGate.media.url} label="player" fallback={isIpadEditionPlayback ? (retry) => (
                  <NativeCinemaFallback key={cinemaMediaGate.media.url} url={cinemaMediaGate.media.url} retry={retry}
                    onApi={(api) => { playerApiRef.current = api; }}
                    onClock={(position, duration) => {
                      if (isCurrentPlaybackEvent(cinemaMediaGate.media.episodeKey)) setWatchClock({ position, duration });
                    }}
                    onProgress={(position, duration) => handleProgress(position, duration, cinemaMediaGate.media.episodeKey)}
                    onEnded={() => handleEnded(cinemaMediaGate.media.episodeKey)}
                    getRestorePosition={getRestorePosition}
                    onSwitch={() => { setCinemaPanel(null); setSidebarTab('sources'); setShowPlayerPanel(true); }}
                    panel={cinemaPanel} onClosePanel={() => setCinemaPanel(null)} />
                ) : undefined}>
                <PlayerShell
                  url={cinemaMediaGate.media.url}
                  title={videoTitle}
                  cinemaMode={isIpadEditionPlayback}
                  cinemaPanel={cinemaPanel}
                  onCloseCinemaPanel={() => setCinemaPanel(null)}
                  onCinemaPanelChange={setCinemaPanel}
                  mediaType={cinemaMediaGate.media.mediaType}
                  adFilter={store.adFilter}
                  autoplayNext={store.autoplayNext}
                  skipMark={skipMark}
                  autoSkipSegments={store.autoSkipSegments}
                  pendingStart={pendingStart}
                  onPendingStart={setPendingStart}
                  onPlayerApi={(api) => { playerApiRef.current = api; }}
                  onRecordSegment={handleRecordSegment}
                  episodeKey={cinemaMediaGate.media.episodeKey}
                  sourceKey={cinemaMediaGate.media.sourceKey}
                  resourceKey={cinemaMediaGate.media.episodeKey}
                  dolbyVisionAssetId={cinemaMediaGate.media.dolbyVisionAssetId}
                  dolbyVisionSourceKind={cinemaMediaGate.media.dolbyVisionSourceKind}
                  dolbyVisionSourceIdentity={cinemaMediaGate.media.dolbyVisionSourceIdentity}
                  onPlaybackSample={(sample) => useAppStore.getState().recordPlaybackSample(sample)}
                  onRequestFullscreen={requestWatchFullscreen}
                  onRequestSwitchSource={() => {
                    const video = playerFrameRef.current?.querySelector('video');
                    const position = video && Number.isFinite(video.currentTime) ? video.currentTime : watchClockRef.current.position;
                    if (video && Number.isFinite(video.currentTime)) {
                      setWatchClock((current) => ({ ...current, position: video.currentTime }));
                    }
                    if (isIpadEditionPlayback) {
                      // Background source recovery only, bounded to two requests
                      // for the same film/episode. Never open a new selection UI.
                      setRuntimeRecovery((previous) => ({
                        episodeKey: recoveryEpisodeKey,
                        attempt: previous.episodeKey === recoveryEpisodeKey ? Math.min(2, previous.attempt + 1) : 1,
                        position,
                      }));
                      return;
                    }
                    setSwitchOpen(true);
                  }}
                  nextUrl={currentIndex + 1 < episodes.length ? episodes[currentIndex + 1] : undefined}
                  nextEpisodeKey={currentIndex + 1 < episodes.length ? `${sourceKey}:${vodId}:${currentIndex + 1}` : undefined}
                  getRestorePosition={getRestorePosition}
                  onTimeUpdate={(position, duration, eventEpisodeKey) => {
                    if (!isCurrentPlaybackEvent(eventEpisodeKey)) return;
                    // Render the timeline from every native media timeupdate (typically
                    // several times per second) so the scrubber never visibly jumps.
                    setWatchClock({ position, duration });
                  }}
                  onProgressSave={handleProgress}
                  onPause={(position, duration, eventEpisodeKey) => {
                    if (!isCurrentPlaybackEvent(eventEpisodeKey)) return;
                    setWatchClock({ position, duration });
                    handleProgress(position, duration, eventEpisodeKey);
                  }}
                  onEnded={handleEnded}
                  onPlaybackConfirmed={(evidence) => {
                    // A retained outgoing player must not certify the destination provider.
                    if (!isCinemaPlaybackEventCurrent({
                      isCinema: isIpadEditionPlayback, cmsLookupPending: cinemaMediaPending,
                      holdingPrevious: cinemaMediaGate.holdingPrevious, currentEpisodeKey,
                    })) return;
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
                    // Quality measurements from held media cannot be attributed to a new source.
                    if (!isCinemaPlaybackEventCurrent({
                      isCinema: isIpadEditionPlayback, cmsLookupPending: cinemaMediaPending,
                      holdingPrevious: cinemaMediaGate.holdingPrevious, currentEpisodeKey,
                    })) return;
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
                </PlaybackErrorBoundary>
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
              <button type="button" data-friday-material="cinema" className="cinema-glass-control cinema-skip-control" aria-label="后退 10 秒" onClick={() => {
                skipCinemaPlayback(-10);
              }}>
                <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 8L8 16l10 8M10 17a17 17 0 1 0 8-8" /><text x="24" y="29">10</text></svg>
              </button>
              <button
                type="button"
                data-friday-material="cinema" className="cinema-glass-control cinema-play-control"
                aria-label={isPlaying ? '暂停' : '播放'}
                aria-pressed={isPlaying}
                title={isPlaying ? '暂停' : '播放'}
                data-playback-state={isPlaying ? 'playing' : 'paused'}
                onClick={() => {
                  const video = playerFrameRef.current?.querySelector('video');
                  if (!video) return;
                  toggleWatchPlayback(
                    video,
                    (candidate) => playerFrameRef.current?.querySelector('video') === candidate,
                    setIsPlaying,
                  );
                }}
              >
                {isPlaying
                  ? <svg className="cinema-play-icon cinema-play-icon--pause" viewBox="0 0 48 48" aria-hidden="true"><path d="M16 11v26M32 11v26" /></svg>
                  : <svg className="cinema-play-icon cinema-play-icon--play" viewBox="0 0 48 48" aria-hidden="true"><path d="M17 10.8c0-1.2 1.3-1.9 2.3-1.2l17.2 11.7a1.5 1.5 0 0 1 0 2.5L19.3 35.5c-1 .7-2.3 0-2.3-1.2V10.8Z" /></svg>}
              </button>
              <button type="button" data-friday-material="cinema" className="cinema-glass-control cinema-skip-control" aria-label="前进 10 秒" onClick={() => {
                skipCinemaPlayback(10);
              }}>
                <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M30 8l10 8-10 8M38 17a17 17 0 1 1-8-8" /><text x="24" y="29">10</text></svg>
              </button>
            </div>

            {!isIpadEditionPlayback && <ClassicWatchTitle
              title={videoTitle} sourceName={source.name}
              hasEpisodes={hasEpisodeNavigation} currentIndex={currentIndex}
              episodeCount={episodes.length} isMovie={isMovie}
            />}

            <section className="watch-cinema-info" aria-label="影片信息">
              <div className="watch-cinema-playback">
                <div className="watch-cinema-time">
                  <span>{formatWatchTime(displayedPosition)}</span>
                  <span>{watchClock.duration > 0 ? `-${formatWatchTime(Math.max(0, watchClock.duration - displayedPosition))}` : '--:--'}</span>
                </div>
                {isIpadEditionPlayback ? (
                  <div
                    className="watch-cinema-progress cinema-seek-surface"
                    role="slider"
                    tabIndex={hasFiniteDuration ? 0 : -1}
                    aria-label="播放进度"
                    aria-disabled={!hasFiniteDuration}
                    aria-valuemin={0}
                    aria-valuemax={hasFiniteDuration ? watchClock.duration : 1}
                    aria-valuenow={Math.min(safeDisplayedPosition, hasFiniteDuration ? watchClock.duration : 1)}
                    aria-valuetext={`${formatWatchTime(displayedPosition)} / ${formatWatchTime(watchClock.duration)}`}
                    style={{ '--watch-progress': `${progressPercent}%` } as CSSProperties}
                    onPointerDown={(event) => {
                      if (!hasFiniteDuration || !event.isPrimary || event.button !== 0) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const surface = event.currentTarget;
                      if (scrubResetTimerRef.current !== null) {
                        window.clearTimeout(scrubResetTimerRef.current);
                        scrubResetTimerRef.current = null;
                      }
                      const rect = surface.getBoundingClientRect();
                      const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))) * watchClock.duration;
                      // Capture explicitly on the seek surface, never on the
                      // HTML video or a native range thumb.
                      surface.setPointerCapture(event.pointerId);
                      scrubbingRef.current = true;
                      setIsScrubbing(true);
                      scrubbingPositionRef.current = position;
                      setScrubbingPosition(position);
                    }}
                    onPointerMove={(event) => {
                      if (!scrubbingRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))) * watchClock.duration;
                      scrubbingPositionRef.current = position;
                      setScrubbingPosition(position);
                    }}
                    onPointerUp={(event) => {
                      if (!scrubbingRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      event.stopPropagation();
                      const surface = event.currentTarget;
                      const rect = surface.getBoundingClientRect();
                      const target = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))) * watchClock.duration;
                      scrubbingRef.current = false;
                      setIsScrubbing(false);
                      scrubbingPositionRef.current = target;
                      setScrubbingPosition(target);
                      surface.releasePointerCapture(event.pointerId);
                      // One seek on release; reconcile the displayed clock with
                      // the actual media position. Native seeked/timeupdate
                      // can subsequently correct it to the actual media position.
                      // Without this the slider snaps back to the pre-drag clock.
                      const playerApi = playerApiRef.current;
                      if (!playerApi) {
                        setScrubbingPosition(null);
                        scrubbingPositionRef.current = null;
                        return;
                      }
                      playerApi.seek(target);
                      // The engine may clamp or reject the requested seek. Use the
                      // actual media position, not an optimistic unplayable target.
                      const actualPosition = playerApi.getCurrentTime();
                      if (!Number.isFinite(actualPosition)) {
                        setScrubbingPosition(null);
                        scrubbingPositionRef.current = null;
                        return;
                      }
                      scrubbingPositionRef.current = actualPosition;
                      setScrubbingPosition(actualPosition);
                      setWatchClock(current => ({ ...current, position: actualPosition }));
                      if (scrubResetTimerRef.current !== null) window.clearTimeout(scrubResetTimerRef.current);
                      scrubResetTimerRef.current = window.setTimeout(() => {
                        setScrubbingPosition(null);
                        scrubbingPositionRef.current = null;
                        scrubResetTimerRef.current = null;
                      }, 1200);
                    }}
                    onPointerCancel={(event) => {
                      if (!scrubbingRef.current) return;
                      event.stopPropagation();
                      scrubbingRef.current = false;
                      setIsScrubbing(false);
                      setScrubbingPosition(null);
                      scrubbingPositionRef.current = null;
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                    }}
                    onLostPointerCapture={() => {
                      if (!scrubbingRef.current) return;
                      // Safari may revoke capture without a pointercancel. Never
                      // leave the controls permanently locked in drag mode.
                      scrubbingRef.current = false;
                      setIsScrubbing(false);
                      setScrubbingPosition(null);
                      scrubbingPositionRef.current = null;
                    }}
                    onKeyDown={(event) => {
                      if (!hasFiniteDuration || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const position = Math.max(0, Math.min(watchClock.duration,
                        event.key === 'Home' ? 0 : event.key === 'End' ? watchClock.duration :
                          safeDisplayedPosition + (event.key === 'ArrowLeft' ? -5 : 5)));
                      const api = playerApiRef.current;
                      if (!api) return;
                      api.seek(position);
                      const actualPosition = api.getCurrentTime();
                      if (!Number.isFinite(actualPosition)) return;
                      if (scrubResetTimerRef.current !== null) {
                        window.clearTimeout(scrubResetTimerRef.current);
                        scrubResetTimerRef.current = null;
                      }
                      scrubbingPositionRef.current = null;
                      setScrubbingPosition(null);
                      setWatchClock(current => ({ ...current, position: actualPosition }));
                    }}
                  >
                    <span className="cinema-seek-track" aria-hidden="true" />
                    <span className="cinema-seek-thumb" aria-hidden="true" />
                  </div>
                ) : (
                <input
                  className="watch-cinema-progress"
                  type="range"
                  min={0}
                  max={hasFiniteDuration ? watchClock.duration : 1}
                  step={1}
                  value={hasFiniteDuration ? Math.min(safeDisplayedPosition, watchClock.duration) : 0}
                  style={{ '--watch-progress': `${progressPercent}%` } as CSSProperties}
                  aria-label="播放进度"
                  aria-valuetext={`${formatWatchTime(displayedPosition)} / ${formatWatchTime(watchClock.duration)}`}
                  onChange={(event) => {
                    // Dragging updates the thumb/preview only. Seeking the media
                    // on every input event causes repeated HLS flushes and stutter.
                    const position = Number(event.target.value);
                    scrubbingPositionRef.current = position;
                    setScrubbingPosition(position);
                    // WebKit can deliver the final range change after touchend.
                    if (!scrubbingRef.current) {
                      const api = playerApiRef.current;
                      api?.seek(position);
                      const actualPosition = api?.getCurrentTime();
                      if (typeof actualPosition === 'number' && Number.isFinite(actualPosition)) {
                        setWatchClock((current) => ({ ...current, position: actualPosition }));
                      }
                      // Keyboard/native range changes do not begin a drag preview.
                      if (scrubResetTimerRef.current !== null) {
                        window.clearTimeout(scrubResetTimerRef.current);
                        scrubResetTimerRef.current = null;
                      }
                      scrubbingPositionRef.current = null;
                      setScrubbingPosition(null);
                    }
                  }}
                  onTouchStart={(event) => {
                    if (!isIpadEditionPlayback || !hasFiniteDuration) return;
                    const touch = event.touches[0];
                    if (!touch) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    if (rect.width <= 0) return;
                    const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)) * watchClock.duration;
                    scrubbingPositionRef.current = position;
                    setScrubbingPosition(position);
                  }}
                  onTouchMove={(event) => {
                    if (!isIpadEditionPlayback || !hasFiniteDuration || !scrubbingRef.current) return;
                    const touch = event.touches[0];
                    if (!touch) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    if (rect.width <= 0) return;
                    const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)) * watchClock.duration;
                    scrubbingPositionRef.current = position;
                    setScrubbingPosition(position);
                  }}
                  onPointerDown={() => {
                    // The shell capture listener starts the scrub lifecycle.
                    // Do not call setPointerCapture here: iOS Safari's native
                    // range control can lose its drag stream when capture is
                    // transferred from the browser's slider implementation.
                  }}
                  onKeyUp={(event) => {
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                      const position = Number(event.currentTarget.value);
                      if (!Number.isFinite(position)) return;
                      // The range onChange already commits this seek. Keyup only
                      // reconciles the clock, avoiding a duplicate HLS seek.
                      const actualPosition = playerApiRef.current?.getCurrentTime();
                      if (typeof actualPosition === 'number' && Number.isFinite(actualPosition)) {
                        setWatchClock((current) => ({ ...current, position: actualPosition }));
                      }
                      if (scrubResetTimerRef.current !== null) {
                        window.clearTimeout(scrubResetTimerRef.current);
                        scrubResetTimerRef.current = null;
                      }
                      scrubbingPositionRef.current = null;
                      setScrubbingPosition(null);
                    }
                  }}
                  disabled={!hasFiniteDuration}
                />

                )}
                {isScrubbing && <output className="watch-cinema-scrub-preview" aria-live="off">{formatWatchTime(displayedPosition)}</output>}
                {!isIpadEditionPlayback && <ClassicWatchRateButton rate={watchRate} onCycle={() => {
                  const rates = [1, 1.25, 1.5, 2, 0.75];
                  const current = playerApiRef.current?.getPlaybackRate() ?? watchRate;
                  const next = rates[(rates.indexOf(current) + 1 + rates.length) % rates.length];
                  playerApiRef.current?.setPlaybackRate(next);
                  if (playerApiRef.current) setWatchRate(playerApiRef.current.getPlaybackRate());
                }} />}
              </div>
            </section>

            {isIpadEditionPlayback && <CinemaPlaybackActions
              rate={watchRate}
              locked={cinemaLocked}
              hasEpisodes={hasEpisodeNavigation}
              panel={cinemaPanel}
              sourcePanelOpen={showPlayerPanel && sidebarTab === 'sources'}
              onRate={() => {
                const next = nextCinemaPlaybackRate(playerApiRef.current?.getPlaybackRate() ?? watchRate);
                playerApiRef.current?.setPlaybackRate(next);
                if (playerApiRef.current) setWatchRate(playerApiRef.current.getPlaybackRate());
              }}
              onLock={() => { setCinemaPanel(null); setCinemaLocked((locked) => !locked); }}
              onEpisodes={() => { setCinemaPanel(null); setSidebarTab('episodes'); setShowPlayerPanel(true); }}
              onAudioAndSubtitles={() => { setShowPlayerPanel(false); setCinemaPanel((panel) => panel === 'audio' || panel === 'subtitles' ? null : toggleCinemaPanel(panel, 'audio')); }}
              onQuality={() => { setShowPlayerPanel(false); setCinemaPanel((panel) => toggleCinemaPanel(panel, 'quality')); }}
              onSources={() => { setCinemaPanel(null); setSidebarTab('sources'); setShowPlayerPanel(true); }}
              onDiagnostics={() => { setShowPlayerPanel(false); setCinemaPanel((panel) => toggleCinemaPanel(panel, 'diagnostics')); }}
              onFullscreen={requestWatchFullscreen}
              onUnlock={() => setCinemaLocked(false)}
            />}
            {!isIpadEditionPlayback && <ClassicWatchTools
              hasEpisodes={hasEpisodeNavigation} currentIndex={currentIndex}
              episodeCount={episodes.length} skipPanelOpen={skipPanelOpen}
              markedCount={markedCount} autoplayNext={store.autoplayNext}
              onPrevious={() => goEpisode(currentIndex - 1)}
              onNext={() => goEpisode(currentIndex + 1)}
              onDownload={downloadCurrentEpisode}
              onToggleSkip={() => setSkipPanelOpen((value) => !value)}
              onAutoplayNext={(value) => store.updateSettings({ autoplayNext: value })}
            />}
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
                {isIpadEditionPlayback && (
                  <div className="cinema-v4-advanced-actions">
                    <h4>高级播放操作</h4>
                    <button type="button" onClick={() => { setShowPlayerPanel(false); setSkipPanelOpen(true); }}>
                      跳过片段标记{markedCount > 0 ? `（${markedCount}）` : ''}
                    </button>
                    <button type="button" disabled={!currentUrl} onClick={downloadCurrentEpisode}>下载本集</button>
                    <label>
                      <input type="checkbox" checked={store.autoplayNext} onChange={(event) => store.updateSettings({ autoplayNext: event.target.checked })} />
                      自动播放下一集
                    </label>
                  </div>
                )}
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
