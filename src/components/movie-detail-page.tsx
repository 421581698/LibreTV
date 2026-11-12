'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/client-api';
import { useAppStore, resolveSource } from '@/lib/store';
import { useAuth } from '@/components/auth';
import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';
import { SmartImage } from '@/components/smart-image';
import { LoadingState, ErrorState } from '@/components/states';
import { addFavorite, addSearchHistory, db, removeFavorite } from '@/lib/db';
import { favoriteIdFor } from '@/lib/favorite-id';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { formatRemarks } from '@/lib/remarks';\nimport { isMovieType } from '@/lib/cms-parser';
import type { SourceConfig, VideoDetail } from '@/lib/types';

function detailSource(store: Pick<ReturnType<typeof useAppStore.getState>, 'customAPIs' | 'envSources'>, key: string, name: string, sourceUrl: string): SourceConfig | null {
  const local = resolveSource(store, key);
  if (key === 'friday-cms' && sourceUrl) {
    if (!validateSourceUrl(sourceUrl)) return null;
    return { ...(local ?? {}), key, name: name || local?.name || 'Friday CMS', url: sourceUrl, detail: undefined };
  }
  if (local) return local;
  if (sourceUrl && validateSourceUrl(sourceUrl)) return { key, name: name || key, url: sourceUrl };
  return null;
}

export function MovieDetailPage() {
  const router = useRouter();
  const params = useSearchParams();
  const customAPIs = useAppStore((state) => state.customAPIs);
  const envSources = useAppStore((state) => state.envSources);
  const imageProxyMode = useAppStore((state) => state.imageProxyMode);
  const customImageProxy = useAppStore((state) => state.customImageProxy);
  const { verified } = useAuth();
  const sourceKey = params.get('source') ?? '';
  const vodId = params.get('id') ?? '';
  const title = params.get('title') ?? '未知影片';
  const poster = params.get('pic') ?? '';
  const rating = params.get('rating') ?? '';
  const sourceName = params.get('sourceName') ?? sourceKey;
  const sourceUrl = params.get('sourceUrl') ?? '';
  const source = useMemo(
    () => detailSource({ customAPIs, envSources }, sourceKey, sourceName, sourceUrl),
    [customAPIs, envSources, sourceKey, sourceName, sourceUrl],
  );
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);

  const favoriteId = sourceKey && vodId ? favoriteIdFor(sourceKey, vodId) : '';
  const favorite = useLiveQuery(
    () => favoriteId ? db.favorites.get(favoriteId) : undefined,
    [favoriteId],
  );
  const history = useLiveQuery(
    () => sourceKey && vodId ? db.history.get(`${sourceKey}_${vodId}`) : undefined,
    [sourceKey, vodId],
  );
  const progress = useLiveQuery(
    () => sourceKey && vodId
      ? db.progress.where('key').startsWith(`${sourceKey}_${vodId}_`).toArray()
      : [],
    [sourceKey, vodId],
  );
  const progressByIndex = useMemo(
    () => new Map((progress ?? []).map((entry) => [Number(entry.key.split('_').at(-1)), entry])),
    [progress],
  );

  useEffect(() => {
    if (!sourceKey || !vodId) {
      setError('影片定位信息不完整，请从首页或搜索结果重新进入');
      setLoading(false);
      return;
    }
    if (!verified) return;
    if (!source) {
      setError('点播源不存在或地址未通过安全校验，请检查设置中的数据源');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setDetail(null);
    api.detail(vodId, source, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch((reason) => {
        if (controller.signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) return;
        setError(reason instanceof Error ? reason.message : '获取影片详情失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sourceKey, vodId, source, verified]);

  const info = detail?.videoInfo;
  const episodes = detail?.episodes ?? [];
  const episodeItems = detail?.episodeItems ?? [];
  const episodeTitle = (index: number) => episodeItems[index]?.title || '第 ' + (index + 1) + ' 集';
  const isMovie = isMovieType(info?.typeName, episodes.length);
  const displayTitle = info?.title || title;
  const image = info?.cover || poster;
  const metadata = [
    info?.year,
    info?.area,
    info?.typeName,
    rating ? '豆瓣 ' + rating : undefined,
    formatRemarks(info?.remarks),
  ].filter((value): value is string => Boolean(value));

  const play = useCallback((index: number) => {
    if (!sourceKey || !vodId || !episodes[index]) return;
    void addSearchHistory(displayTitle).catch(() => {});
    router.push(buildWatchUrl({
      sourceKey,
      vodId,
      index,
      title: displayTitle,
      sourceUrl: source?.url || sourceUrl || undefined,
    }));
  }, [sourceKey, vodId, episodes, displayTitle, router, source, sourceUrl]);

  const toggleFavorite = async () => {
    if (!sourceKey || !vodId) return;
    if (favorite) {
      await removeFavorite(sourceKey, vodId);
      return;
    }
    await addFavorite({
      sourceKey,
      sourceUrl: source?.url || sourceUrl || undefined,
      sourceName: sourceName || sourceKey,
      vodId,
      title: displayTitle,
      pic: image || undefined,
      typeName: info?.typeName,
      year: info?.year,
      remarks: info?.remarks,
    });
  };

  const share = async () => {
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: displayTitle, text: info?.desc || displayTitle, url: window.location.href });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(window.location.href);
      }
    } catch {
      // User cancellation is not an error; unsupported sharing remains a no-op.
    } finally {
      setSharing(false);
    }
  };

  const completedPercent = (index: number) => {
    const item = progressByIndex.get(index);
    if (!item?.duration) return 0;
    return Math.min(100, Math.max(0, Math.round(item.position / item.duration * 100)));
  };

  if (loading) {
    return <main className="movie-detail-page min-h-screen bg-[#08080A] px-5 pt-8 text-white"><V4HomepageHeader /><div className="pt-16"><LoadingState label="正在整理影片详情…" /></div></main>;
  }
  if (error || !detail) {
    return (
      <main className="movie-detail-page min-h-screen bg-[#08080A] px-5 pt-8 text-white">
        <V4HomepageHeader />
        <button type="button" onClick={() => router.back()} className="mb-8 rounded-full bg-white/10 px-4 py-2 text-sm">‹ 返回</button>
        <ErrorState message={error || '暂时无法获取影片详情'} />
      </main>
    );
  }

  return (
    <main className="movie-detail-page min-h-screen overflow-x-hidden bg-[#08080A] pb-[calc(96px+env(safe-area-inset-bottom))] text-white">
      <V4HomepageHeader />
      <section className="relative isolate min-h-[650px] overflow-hidden sm:min-h-[720px]">
        {image ? (
          <SmartImage
            url={image}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={displayTitle}
            className="absolute inset-0 -z-20 h-full w-full object-cover object-center opacity-80"
            loading="eager"
          />
        ) : null}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/25 via-black/35 to-[#08080A]" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/55 via-black/10 to-transparent" />

        <header className="relative z-10 flex items-center justify-between px-5 pt-[max(18px,env(safe-area-inset-top))] sm:px-10">
          <button type="button" onClick={() => router.back()} className="flex h-10 items-center gap-2 rounded-full bg-black/35 px-4 text-sm text-white backdrop-blur-xl" aria-label="返回上一页">
            <span aria-hidden="true">‹</span><span>返回</span>
          </button>
          <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-[11px] text-white/75 backdrop-blur-xl">{sourceName}</span>
        </header>

        <div className="relative z-10 mx-auto flex min-h-[590px] max-w-6xl flex-col justify-end px-5 pb-12 pt-40 sm:min-h-[650px] sm:px-10 sm:pb-16">
          <div className="max-w-2xl">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[.28em] text-white/65">LIBRETV · TITLE DETAILS</p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-.045em] sm:text-6xl">{displayTitle}</h1>
            {metadata.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-white/75 sm:text-sm">
                {metadata.map((value) => <span key={value}>{value}</span>)}
              </div>
            )}
            {info?.desc && <p className="mt-5 max-w-xl text-sm leading-7 text-white/80 sm:text-base">{info.desc}</p>}
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => play(0)} disabled={episodes.length === 0} className="inline-flex min-h-12 items-center gap-3 rounded-full bg-white px-7 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40">
                <span aria-hidden="true">▶</span>{isMovie ? '立即播放' : '开始观看'}
              </button>
              <button type="button" onClick={() => void toggleFavorite()} className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-white/10 text-xl backdrop-blur-xl" aria-label={favorite ? '取消收藏' : '加入收藏'} aria-pressed={Boolean(favorite)}>
                <span aria-hidden="true">{favorite ? '♥' : '＋'}</span>
              </button>
              <button type="button" onClick={() => void share()} disabled={sharing} className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-white/10 text-lg backdrop-blur-xl" aria-label="分享影片">↗</button>
            </div>
          </div>
        </div>
      </section>

      {history?.playbackPosition ? (
        <section className="mx-auto -mt-2 max-w-6xl px-5 sm:px-10">
          <button type="button" onClick={() => play(history.episodeIndex)} className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[.06] p-4 text-left backdrop-blur-xl">
            <span><span className="block text-sm font-medium">继续观看</span><span className="mt-1 block text-xs text-white/55">从上次进度继续 · {episodeTitle(history.episodeIndex)}</span></span>
            <span className="text-sm text-white/70">继续播放 →</span>
          </button>
        </section>
      ) : null}

      {!isMovie && episodes.length > 0 && (
        <section className="mx-auto mt-12 max-w-6xl px-5 sm:px-10">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div><p className="text-[10px] font-semibold uppercase tracking-[.24em] text-white/40">EPISODES</p><h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">剧集</h2></div>
            <span className="text-xs text-white/50">共 {episodes.length} 集</span>
          </div>
          <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-4 sm:-mx-10 sm:px-10">
            {episodes.map((_, index) => {
              const percent = completedPercent(index);
              return (
                <button key={index} type="button" onClick={() => play(index)} className="group w-[220px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-[#17171B] text-left transition hover:border-white/30 sm:w-[260px]">
                  <div className="relative flex aspect-video items-center justify-center bg-[#222226]">
                    <span className="text-[11px] font-semibold tracking-[.22em] text-white/30">{String(index + 1).padStart(2, '0')}</span>
                    <span className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm text-black opacity-100">▶</span>
                    {percent > 0 && <span className="absolute inset-x-0 bottom-0 h-1 bg-white/15"><span className="block h-full bg-white" style={{ width: `${percent}%` }} /></span>}
                  </div>
                  <div className="p-3"><p className="text-sm font-medium">{episodeTitle(index)}</p><p className="mt-1 text-[11px] text-white/45">{percent >= 95 ? '已观看' : percent > 0 ? `已观看 ${percent}%` : '选择播放'}</p></div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="mx-auto mt-12 max-w-6xl px-5 sm:px-10">
        <div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-[.24em] text-white/40">ABOUT THIS TITLE</p><h2 className="mt-1 text-xl font-semibold tracking-tight">影片信息</h2></div>
        <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[.035] p-5 sm:grid-cols-2">
          {info?.director && <p className="text-sm"><span className="text-white/40">导演</span><span className="ml-3 text-white/85">{info.director}</span></p>}
          {info?.actor && <p className="text-sm"><span className="text-white/40">主演</span><span className="ml-3 text-white/85">{info.actor}</span></p>}
          {info?.area && <p className="text-sm"><span className="text-white/40">地区</span><span className="ml-3 text-white/85">{info.area}</span></p>}
          {info?.year && <p className="text-sm"><span className="text-white/40">年份</span><span className="ml-3 text-white/85">{info.year}</span></p>}
          <p className="text-sm"><span className="text-white/40">资源线路</span><span className="ml-3 text-white/85">{sourceName}</span></p>
          {info?.remarks && <p className="text-sm"><span className="text-white/40">更新状态</span><span className="ml-3 text-white/85">{formatRemarks(info.remarks)}</span></p>}
        </div>
      </section>
    </main>
  );
}
