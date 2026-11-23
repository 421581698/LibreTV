'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/client-api';
import { useAppStore, resolveSource } from '@/lib/store';
import { useAuth } from '@/components/auth';
import { SmartImage } from '@/components/smart-image';
import { IpadCinemaDetailLayout } from '@/components/ipad-edition/IpadCinemaDetailLayout';
import { LoadingState, ErrorState } from '@/components/states';
import { addFavorite, addSearchHistory, db, removeFavorite } from '@/lib/db';
import { favoriteIdFor } from '@/lib/favorite-id';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { formatRemarks } from '@/lib/remarks';
import { isMovieType } from '@/lib/cms-parser';
import type { SourceConfig, VideoDetail } from '@/lib/types';
import { enqueueDownload } from '@/components/download-manager';
import { fromCmsArtwork, fromEpisodeArtwork } from '@/lib/poster';

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

export function MovieDetailPage({ watchPath = '/watch' }: { watchPath?: '/watch' | '/ipad-edition/watch' }) {
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
  const [tmdbArtwork, setTmdbArtwork] = useState<{ poster: string; backdrop: string } | null>(null);

  // Episode actions are a real popover: dismiss on outside tap or Escape so the
  // menu never remains stranded over the horizontal episode shelf on mobile.
  useEffect(() => {
    if (episodeMenuIndex === null) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(`[data-episode-menu-index="${episodeMenuIndex}"]`);
      if (!card) setEpisodeMenuIndex(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEpisodeMenuIndex(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [episodeMenuIndex]);

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
    setTmdbArtwork(null);
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

  // Ordinary CMS search results do not carry a reliable high-resolution artwork
  // identity. Resolve the title against TMDB only after CMS detail is available;
  // exact localized/original-title and year checks prevent unrelated matches.
  useEffect(() => {
    if (!detail || !info) return;
    const matchTitle = (info.title || title).trim();
    if (!matchTitle) return;
    const mediaType = isMovieType(info.typeName, detail.episodes?.length ?? 0) ? 'movie' : 'tv';
    const controller = new AbortController();
    setTmdbArtwork(null);
    const params = new URLSearchParams({
      title: matchTitle,
      alternateTitle: title,
      ...(info.originalTitle ? { originalTitle: info.originalTitle } : {}),
      type: mediaType,
      ...(info.year ? { year: info.year.slice(0, 4) } : {}),
    });
    fetch('/api/tmdb/match?' + params.toString(), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('TMDB_MATCH_UNAVAILABLE');
        return response.json() as Promise<{ match: { id: number; type: 'movie' | 'tv'; posterUrl?: string; backdropUrl?: string } | null }>;
      })
      .then(async ({ match }) => {
        if (!match || !Number.isInteger(match.id) || match.id <= 0) return;
        const detailsResponse = await fetch('/api/tmdb/details?' + new URLSearchParams({ id: String(match.id), type: match.type }), { signal: controller.signal });
        if (!detailsResponse.ok) throw new Error('TMDB_DETAILS_UNAVAILABLE');
        const metadata = await detailsResponse.json() as { poster_path?: string | null; backdrop_path?: string | null };
        if (controller.signal.aborted) return;
        setTmdbArtwork({
          poster: metadata.poster_path ? `https://image.tmdb.org/t/p/original${metadata.poster_path}` : match.posterUrl || '',
          backdrop: metadata.backdrop_path ? `https://image.tmdb.org/t/p/original${metadata.backdrop_path}` : match.backdropUrl || '',
        });
      })
      .catch(() => {
        // TMDB is an enhancement, never a dependency for CMS detail or playback.
      });
    return () => controller.abort();
  }, [detail, info, title]);
  const episodes = detail?.episodes ?? [];
  const episodeItems = detail?.episodeItems ?? [];
  // Keep landscape backdrops and portrait posters in separate image slots.
  // A low-resolution CMS cover/poster must never be enlarged as the hero backdrop.
  const backdrop = tmdbArtwork?.backdrop || info?.backdrop?.trim() || '';
  const posterArtwork = tmdbArtwork?.poster || info?.cover?.trim() || poster.trim();
  const knownSeasonNumbers = episodeItems
    .map((item) => item.seasonNumber)
    .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0);
  const seasonNumber = knownSeasonNumbers.length === episodes.length
    && knownSeasonNumbers.length > 0
    && knownSeasonNumbers.every((value) => value === knownSeasonNumbers[0])
    ? knownSeasonNumbers[0]
    : undefined;
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
    return (/^第\s*[\d一二两三四五六七八九十]+\s*[集话期]$/u.test(value) ? '' : value)
      || item?.episodeName?.trim()
      || '';
  };
  const isMovie = isMovieType(info?.typeName, episodes.length);
  const displayTitle = info?.title || title;
  const image = posterArtwork;
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
    }).replace('/watch?', watchPath + '?'));
  }, [sourceKey, vodId, episodes, displayTitle, router, source, sourceUrl, watchPath]);

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
    <IpadCinemaDetailLayout
      title={displayTitle}
      eyebrow="LIBRETV · TITLE DETAILS"
      backdropUrl={backdrop || undefined}
      posterUrl={posterArtwork || undefined}
      backdropFallbackUrl={tmdbArtwork?.backdrop ? info?.backdrop?.trim() : undefined}
      imageMode={imageProxyMode}
      customImageProxy={customImageProxy}
      originalTitle={info?.originalTitle || undefined}
      metadata={
        <>
          {metadata.map((value) => <span key={value}>{value}</span>)}
        </>
      }
      overview={info?.desc || '暂无剧情简介'}
      actions={
        <>
          <button type="button" onClick={() => play(0)} disabled={episodes.length === 0} className="ipad-cinema-play">
            <span aria-hidden="true">▶</span>{'▶ 开始播放'}
          </button>
          <button type="button" onClick={() => void toggleFavorite()} className="ipad-cinema-add" aria-label={favorite ? '取消收藏' : '加入收藏'} aria-pressed={Boolean(favorite)}>
            {favorite ? '♥' : '＋'}
          </button>
          <button type="button" onClick={() => void share()} disabled={sharing} className="ipad-cinema-add" aria-label="分享影片">↗</button>
        </>
      }
      onBack={() => router.back()}
    >
      <section className="ipad-cinema-info">
        <div>
          <h2>剧情简介</h2>
          <p>{info?.desc || '暂无剧情简介'}</p>
        </div>
        <dl>
          <div><dt>年份</dt><dd>{info?.year || '暂无数据'}</dd></div>
          <div><dt>地区</dt><dd>{info?.area || '暂无数据'}</dd></div>
          <div><dt>类型</dt><dd>{info?.typeName || '暂无数据'}</dd></div>
          <div><dt>备注</dt><dd>{formatRemarks(info?.remarks) || '暂无数据'}</dd></div>
          <div><dt>播放源</dt><dd>{sourceName || sourceKey}</dd></div>
        </dl>
      </section>
      {!isMovie && episodes.length > 0 && (
        <section className="ipad-cinema-section ipad-cinema-episodes" aria-labelledby="movie-episode-heading">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-white/45">EPISODES</p>
              <h2 id="movie-episode-heading" className="mt-1 text-2xl font-semibold tracking-tight text-white">{seasonNumber ? `第 ${seasonNumber} 季` : '剧集'}</h2>
            </div>
            <span className="text-xs text-white/50">共 {episodes.length} 集</span>
          </div>
          <div className="movie-episode-carousel -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-10 sm:px-10">
            {episodes.map((episodeUrl, index) => {
              const item = episodeItems[index];
              const titleText = episodeDisplayTitle(index) || episodeNumberLabel(index) || episodeTitle(index);
              const detailText = [item?.description?.trim(), item?.duration?.trim()].filter(Boolean).join(' · ');
              return (
                <button
                  key={item?.url || episodeUrl || index}
                  type="button"
                  onClick={() => play(index)}
                  className="movie-episode-card group flex w-[72vw] max-w-[420px] min-w-[260px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[.055] text-left transition hover:border-white/25 hover:bg-white/[.085]"
                  aria-label={`播放${titleText}`}
                >
                  <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-white/[.06]">
                    {(item?.image || image) ? (
                      <SmartImage
                        asset={item?.image ? fromEpisodeArtwork({ sourceKey, vodId, episodeIndex: index, title: titleText, imageUrl: item.image, imageSource: item.imageSource, tmdbEpisodeId: item.tmdbEpisodeId, tmdbSeriesId: item.tmdbSeriesId, seasonNumber: item.seasonNumber, episodeNumber: item.episodeNumber }) : undefined}
                        url={item?.image || image}
                        mode={imageProxyMode}
                        customProxy={customImageProxy}
                        alt={titleText}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-white/40">
                        暂无可用图片
                      </div>
                    )}
                    <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white/90">{episodeNumberLabel(index) || `第 ${index + 1} 集`}</span>
                  </div>
                  <div className="min-w-0 flex-1 p-3 sm:p-4">
                    <h3 className="truncate text-sm font-semibold text-white">{titleText}</h3>
                    {detailText ? (
                      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-white/55">{detailText}</p>
                    ) : (
                      <p className="mt-1.5 text-xs text-white/35">分集简介或时长暂缺</p>
                    )}
                    <span className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-white/75">▶ 播放本集</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </IpadCinemaDetailLayout>
  );
}
