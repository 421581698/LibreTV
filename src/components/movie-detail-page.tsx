'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/client-api';
import { useAppStore, resolveSource } from '@/lib/store';
import { useAuth } from '@/components/auth';
import { SmartImage } from '@/components/smart-image';
import { LoadingState, ErrorState } from '@/components/states';
import { addFavorite, addSearchHistory, db, removeFavorite } from '@/lib/db';
import { favoriteIdFor } from '@/lib/favorite-id';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { formatRemarks } from '@/lib/remarks';
import { isMovieType } from '@/lib/cms-parser';
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
  const { checked, verified } = useAuth();
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
  const [episodeMenuIndex, setEpisodeMenuIndex] = useState<number | null>(null);

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
    // Wait for the shared auth status check, then let the API's 401/503
    // handling open the existing login/setup dialog when access is required.
    if (!checked) return;
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
  }, [sourceKey, vodId, source, checked, verified]);

  const info = detail?.videoInfo;
  const episodes = detail?.episodes ?? [];
  const episodeItems = detail?.episodeItems ?? [];
  // Keep source-provided episode names authoritative. Positional fallback text is
  // explicitly described as a playback item, never fabricated as an episode number.
  const episodeTitle = (index: number) => episodeItems[index]?.title?.trim() || '第 ' + (index + 1) + ' 个播放条目';
  const episodeNumberLabel = (index: number) => {
    const value = episodeItems[index]?.title?.trim() ?? '';
    return /^第\s*[\d一二两三四五六七八九十]+\s*[集话期]$/u.test(value)
      ? value.replace(/\s+/g, '')
      : '';
  };
  const episodeDisplayTitle = (index: number) => {
    const item = episodeItems[index];
    const value = item?.title?.trim() ?? '';
    return (/^第\\s*[\\d一二两三四五六七八九十]+\\s*[集话期]$/u.test(value) ? '' : value)
      || item?.episodeName?.trim()
      || '';
  };
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
    return <main className="movie-detail-page min-h-screen bg-[#08080A] px-5 pt-8 text-white"><div className="pt-16"><LoadingState label="正在整理影片详情…" /></div></main>;
  }
  if (error || !detail) {
    return (
      <main className="movie-detail-page min-h-screen bg-[#08080A] px-5 pt-8 text-white">
        
        <button type="button" onClick={() => router.back()} className="mb-8 rounded-full bg-white/10 px-4 py-2 text-sm">‹ 返回</button>
        <ErrorState message={error || '暂时无法获取影片详情'} />
      </main>
    );
  }

  return (
    <main className="movie-detail-page min-h-screen overflow-x-hidden bg-[#08080A] pb-[calc(96px+env(safe-area-inset-bottom))] text-white">
      
      <section className="movie-detail-hero relative isolate min-h-[560px] overflow-hidden sm:min-h-[640px]">
        {image ? (
          <SmartImage
            url={info?.cover || poster}
            fallbackUrl={info?.cover && poster && info.cover !== poster ? poster : undefined}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={displayTitle}
            className="movie-detail-hero__image absolute inset-0 -z-20 h-full w-full object-cover object-center"
            loading="eager"
          />
        ) : null}
        <div className="movie-detail-hero__scrim absolute inset-0 -z-10" />
        <div className="movie-detail-hero__bottom-gradient absolute inset-x-0 bottom-0 -z-10" />
        <div className="movie-detail-hero__side-gradient absolute inset-0 -z-10" />

        <header className="movie-detail-hero__header relative z-10 flex items-center justify-between px-5 pt-[max(18px,env(safe-area-inset-top))] sm:px-10">
          <button type="button" onClick={() => router.back()} className="movie-detail-glass-control" aria-label="返回上一页">
            <span aria-hidden="true">‹</span>
          </button>
          <span className="movie-detail-glass-control movie-detail-source-pill">{sourceName}</span>
        </header>

        <div className="movie-detail-hero__content relative z-10 mx-auto flex min-h-[520px] max-w-6xl flex-col justify-end px-5 pb-10 pt-32 sm:min-h-[580px] sm:px-10 sm:pb-14">
          <div className="max-w-2xl">
            <p className="movie-detail-eyebrow mb-3 text-[10px] font-semibold uppercase text-white/65">LIBRETV · TITLE DETAILS</p>
            <h1 className="movie-detail-title max-w-3xl text-4xl leading-[1.05] tracking-[-.045em] sm:text-6xl">{displayTitle}</h1>
            {metadata.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-white/75 sm:text-sm">
                {metadata.map((value) => <span key={value}>{value}</span>)}
              </div>
            )}
            {info?.desc && <p className="movie-detail-description mt-5 max-w-xl text-sm leading-7 text-white/80 sm:text-base">{info.desc}</p>}
            <div className="movie-detail-actions mt-7 flex flex-wrap items-center gap-3">
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
          <div className="movie-detail-episode-list" aria-label="横向滑动选择剧集">
            {episodes.map((_, index) => {
              const item = episodeItems[index];
              const percent = completedPercent(index);
              const titleText = episodeDisplayTitle(index);
              const menuOpen = episodeMenuIndex === index;
              return (
                <article key={index} className="movie-detail-episode-card" aria-label={episodeTitle(index)}>
                  <span className="movie-detail-episode-placeholder" aria-hidden="true">
                    <span className="movie-detail-episode-placeholder-play">▶</span>
                  </span>
                  <SmartImage
                    // Episode cards must never disguise the title poster as episode-specific artwork.
                    // Without a verified still for this exact episode, keep the dedicated placeholder visible.
                    url={item?.image}
                    mode={imageProxyMode}
                    customProxy={customImageProxy}
                    alt=""
                    className="movie-detail-episode-image"
                    loading="lazy"
                    showDefaultFallback={false}
                  />
                  <span className="movie-detail-episode-card-gradient" aria-hidden="true" />
                  <button
                    type="button"
                    className="movie-detail-episode-card-hit"
                    onClick={() => play(index)}
                    aria-label={'播放' + episodeTitle(index)}
                  />
                  <span className="movie-detail-episode-card-content">
                    <span className="movie-detail-episode-card-number">{episodeNumberLabel(index)}</span>
                    {<span className="movie-detail-episode-card-title">{titleText || '剧集标题暂缺'}</span>}
                    <span className="movie-detail-episode-card-description">{item?.description?.trim() || '剧集简介暂缺'}</span>
                    <span className="movie-detail-episode-card-meta">
                      <span className="movie-detail-episode-card-play" aria-hidden="true">▶</span>
                      <span>{item?.duration?.trim() || '时长暂缺'}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="movie-detail-episode-card-more"
                    aria-label={episodeTitle(index) + '更多操作'}
                    aria-expanded={menuOpen}
                    onClick={() => setEpisodeMenuIndex(menuOpen ? null : index)}
                  >
                    <span aria-hidden="true">···</span>
                  </button>
                  {menuOpen && (
                    <div className="movie-detail-episode-menu" role="group" aria-label="剧集操作">
                      <button type="button" onClick={() => { setEpisodeMenuIndex(null); play(index); }}>播放本集</button>
                      <button type="button" disabled={!item?.title?.trim()} onClick={() => {
                        setEpisodeMenuIndex(null);
                        if (item?.title?.trim() && navigator.clipboard) void navigator.clipboard.writeText(item.title.trim());
                      }}>复制剧集名称</button>
                    </div>
                  )}
                  {percent > 0 && <span className="movie-detail-episode-card-progress" aria-hidden="true"><span style={{ width: percent + '%' }} /></span>}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="mx-auto mt-12 max-w-6xl px-5 sm:px-10">
        <div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-[.24em] text-white/40">ABOUT THIS TITLE</p><h2 className="mt-1 text-xl font-semibold tracking-tight">影片信息</h2></div>
        <div className="movie-detail-info-grid grid gap-5 sm:grid-cols-2">
          {info?.director && <p className="movie-detail-info-item"><span>导演</span><strong>{info.director}</strong></p>}
          {info?.actor && <p className="movie-detail-info-item"><span>主演</span><strong>{info.actor}</strong></p>}
          {info?.area && <p className="movie-detail-info-item"><span>地区</span><strong>{info.area}</strong></p>}
          {info?.year && <p className="movie-detail-info-item"><span>年份</span><strong>{info.year}</strong></p>}
          <p className="movie-detail-info-item"><span>资源线路</span><strong>{sourceName}</strong></p>
          {info?.remarks && <p className="movie-detail-info-item"><span>更新状态</span><strong>{formatRemarks(info.remarks)}</strong></p>}
        </div>
      </section>
    </main>
  );
}
