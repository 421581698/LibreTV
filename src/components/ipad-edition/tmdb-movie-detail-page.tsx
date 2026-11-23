'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { resolveSource, useAppStore, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { findMovieMatch, getMovieSearchTerms } from '@/lib/movie-title-match';
import type { SourceConfig } from '@/lib/types';

type TmdbPerson = { id: number; name: string; character?: string; profile_path?: string | null; job?: string; department?: string };
type TmdbTitle = {
  id: number; title?: string; name?: string; original_title?: string; original_name?: string;
  overview?: string; poster_path?: string | null; backdrop_path?: string | null; vote_average?: number;
  release_date?: string; first_air_date?: string; runtime?: number; episode_run_time?: number[];
  genres?: { id: number; name: string }[]; production_countries?: { name: string }[];
  credits?: { cast?: TmdbPerson[]; crew?: TmdbPerson[] };
};
type TmdbCredit = { id: number; title?: string; name?: string; character?: string; poster_path?: string | null; release_date?: string; first_air_date?: string };
type TmdbPersonDetails = { id: number; name: string; biography?: string; profile_path?: string | null; birthday?: string; place_of_birth?: string; known_for_department?: string; movie_credits?: { cast?: TmdbCredit[] }; tv_credits?: { cast?: TmdbCredit[] } };

const imageUrl = (path?: string | null, size = 'w780') => path
  ? /^https?:\\/\\//i.test(path) ? path : `https://image.tmdb.org/t/p/${size}${path}`
  : '';

export function TmdbMovieDetailPage({ id, type, titleFallback, backdropFallback, ratingFallback }: {
  id: string; type: 'movie' | 'tv'; titleFallback: string; posterFallback: string; backdropFallback: string; ratingFallback: string;
}) {
  const router = useRouter();
  const selectedKeys = useAppStore((state) => state.selectedKeys);
  const customAPIs = useAppStore((state) => state.customAPIs);
  const envSources = useAppStore((state) => state.envSources);
  const sourceHealth = useAppStore((state) => state.sourceHealth);
  const subscriptions = useAppStore((state) => state.subscriptions);
  const yellowFilter = useAppStore((state) => state.yellowFilter);
  const [movie, setMovie] = useState<TmdbTitle | null>(null);
  const [loading, setLoading] = useState(true);
  const [metadataError, setMetadataError] = useState('');
  const [startingPlayback, setStartingPlayback] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState('点击「开始播放」后才会查询已启用的点播源。');
  const [person, setPerson] = useState<TmdbPersonDetails | null>(null);
  const [personLoading, setPersonLoading] = useState(false);

  const sources = useMemo(() => selectedKeys.map((key) => resolveSource({ customAPIs, envSources }, key))
    .filter((source): source is SourceConfig => Boolean(source && validateSourceUrl(source.url)
      && !isSourceDisabled({ sourceHealth }, source.key)
      && !isInDisabledSubscription({ subscriptions }, source.key))),
  [selectedKeys, customAPIs, envSources, sourceHealth, subscriptions]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setMetadataError('');
    fetch('/api/tmdb/details?' + new URLSearchParams({ id, type }), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || '无法获取影片资料');
        return response.json() as Promise<TmdbTitle>;
      })
      .then(setMovie)
      .catch((error) => { if (!controller.signal.aborted) setMetadataError(error instanceof Error ? error.message : '无法获取影片资料'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, type]);

  const startPlayback = async () => {
    if (startingPlayback) return;
    if (!sources.length) {
      setPlaybackStatus('尚未启用可用点播源。请先在设置中启用点播源，再点击开始播放。');
      return;
    }
    setStartingPlayback(true);
    setPlaybackStatus('正在查找该影片的播放资源…');
    try {
      const primaryTitle = movie?.title || movie?.name || titleFallback;
      const originalTitle = movie?.original_title || movie?.original_name || '';
      const terms = [...new Set([
        ...getMovieSearchTerms(primaryTitle),
        ...(originalTitle ? getMovieSearchTerms(originalTitle) : []),
      ])];
      let match: { item: { sourceKey: string; vodId: string; name: string; sourceUrl?: string }; source: SourceConfig } | undefined;
      const failures = new Set<string>();
      for (const term of terms) {
        const response = await api.search(term, sources, yellowFilter);
        response.failures.forEach((failure) => failures.add(failure.sourceKey));
        const found = findMovieMatch(primaryTitle, response.list)
          || findMovieMatch(term, response.list);
        if (found) {
          const source = sources.find((candidate) => candidate.key === found.sourceKey);
          if (source) {
            match = { item: found, source };
            break;
          }
        }
      }
      if (!match) {
        setPlaybackStatus(failures.size
          ? `没有匹配到影片资源；另有 ${failures.size} 个点播源请求失败，请检查源状态后重试。`
          : '暂未找到匹配的播放资源。影片资料仍可继续浏览，请稍后重试或检查点播源。');
        return;
      }
      const watchUrl = buildWatchUrl({
        sourceKey: match.source.key,
        vodId: match.item.vodId,
        index: 0,
        title: primaryTitle,
        sourceUrl: match.item.sourceUrl || match.source.url,
      }).replace('/watch?', '/ipad-edition/watch?');
      router.push(watchUrl);
    } catch (error) {
      setPlaybackStatus(error instanceof Error ? error.message : '播放资源查询失败，请稍后重试。');
    } finally {
      setStartingPlayback(false);
    }
  };

  const openPerson = async (personId: number) => {
    setPersonLoading(true);
    setPerson(null);
    try {
      const response = await fetch('/api/tmdb/person?' + new URLSearchParams({ id: String(personId) }));
      if (!response.ok) throw new Error('人物资料暂时不可用');
      setPerson(await response.json() as TmdbPersonDetails);
    } catch {
      setPerson({ id: personId, name: '人物资料暂时不可用' });
    } finally {
      setPersonLoading(false);
    }
  };

  const title = movie?.title || movie?.name || titleFallback;
  // iPad detail uses one landscape still as its hero; do not substitute a portrait poster.
  const backdrop = imageUrl(movie?.backdrop_path || backdropFallback, 'original');
  const cast = movie?.credits?.cast?.slice(0, 18) || [];
  const director = movie?.credits?.crew?.find((member) => member.job === 'Director')?.name;
  const releaseYear = (movie?.release_date || movie?.first_air_date || '').slice(0, 4);
  const runtime = movie?.runtime || movie?.episode_run_time?.[0];

  if (loading) return <main className="min-h-screen bg-[#08080a] p-10 text-white">正在加载电影资料…</main>;
  if (!movie) return <main className="min-h-screen bg-[#08080a] p-10 text-white"><button onClick={() => router.back()}>‹ 返回</button><p className="mt-8">{metadataError || '电影资料暂时不可用'}</p></main>;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#08080a] pb-12 text-white">
      <div className="mx-auto max-w-[1600px] px-4 pt-5 sm:px-6 md:px-10 md:pt-7">
        <header className="mb-4 flex items-center justify-between">
          <button type="button" onClick={() => router.back()} className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-sm text-white/90 transition hover:bg-white/10">‹ 返回</button>
          <p className="text-[10px] font-medium uppercase tracking-[.24em] text-white/45 md:text-xs">LIBRETV CINEMA · iPAD EDITION</p>
          <span aria-hidden="true" className="w-[4.5rem]" />
        </header>

        {backdrop ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-white/[0.04] shadow-2xl ring-1 ring-white/10 md:rounded-2xl">
            <img src={backdrop} alt={title + ' 横屏电影剧照'} loading="eager" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-sm text-white/45 md:rounded-2xl">
            暂无横屏剧照
          </div>
        )}

        <section className="pt-6 md:pt-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-3xl font-bold leading-tight tracking-tight md:text-4xl lg:text-5xl">{title}</h1>
              {movie.original_title || movie.original_name ? (
                <p className="mt-2 text-sm text-white/50 md:text-base">{movie.original_title || movie.original_name}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/65">
                {releaseYear && <span>{releaseYear}</span>}
                {movie.genres?.length ? <span>{movie.genres.map((genre) => genre.name).join(' / ')}</span> : null}
                <span className="inline-flex items-center gap-1 text-amber-300"><span aria-hidden="true">★</span>{(movie.vote_average || Number(ratingFallback) || 0).toFixed(1)}</span>
                {runtime ? <span>{runtime} 分钟{type === 'tv' ? '/集' : ''}</span> : null}
              </div>
              {director ? <p className="mt-2 text-sm text-white/55">导演：{director}</p> : null}
            </div>
            <div className="flex shrink-0 flex-col gap-3 lg:w-[min(100%,18rem)]">
              <button type="button" onClick={() => void startPlayback()} disabled={startingPlayback} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-semibold text-black shadow-lg shadow-black/20 transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-50 md:text-lg">
                <span aria-hidden="true">▶</span>{startingPlayback ? '正在查找资源…' : '开始播放'}
              </button>
              <p className="text-center text-xs leading-5 text-white/55" role="status" aria-live="polite">{playbackStatus}</p>
            </div>
          </div>
        </section>

        <section className="mt-9 grid gap-8 border-t border-white/10 pt-7 md:mt-11 md:grid-cols-[minmax(0,1.6fr)_minmax(16rem,1fr)] md:gap-12 md:pt-9">
          <div className="min-w-0">
            <h2 className="mb-3 text-xl font-semibold md:text-2xl">剧情简介</h2>
            <p className="whitespace-pre-line text-sm leading-7 text-white/70 md:text-base md:leading-8">{movie.overview || '暂无剧情简介'}</p>
          </div>
          <div>
            <h2 className="mb-4 text-xl font-semibold md:text-2xl">影片信息</h2>
            <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
              <dt className="text-white/45">导演</dt><dd className="text-white/80">{director || '暂无数据'}</dd>
              <dt className="text-white/45">年份</dt><dd className="text-white/80">{releaseYear || '暂无数据'}</dd>
              <dt className="text-white/45">类型</dt><dd className="text-white/80">{movie.genres?.map((genre) => genre.name).join('、') || '暂无数据'}</dd>
              <dt className="text-white/45">片长</dt><dd className="text-white/80">{runtime ? `${runtime} 分钟${type === 'tv' ? '/集' : ''}` : '暂无数据'}</dd>
              <dt className="text-white/45">国家/地区</dt><dd className="text-white/80">{movie.production_countries?.map((country) => country.name).join('、') || '暂无数据'}</dd>
              <dt className="text-white/45">评分</dt><dd className="text-white/80">{(movie.vote_average || 0).toFixed(1)} / 10</dd>
            </dl>
          </div>
        </section>

        <section className="mt-10 border-t border-white/10 pt-7 md:mt-12 md:pt-9">
          <h2 className="mb-5 text-xl font-semibold md:text-2xl">演员阵容</h2>
          {cast.length ? (
            <div className="flex gap-4 overflow-x-auto pb-4 md:gap-5">
              {cast.map((actor) => (
                <button key={actor.id} type="button" onClick={() => void openPerson(actor.id)} className="w-28 shrink-0 text-left md:w-32">
                  <img src={imageUrl(actor.profile_path, 'w185') || '/placeholder.svg'} alt={actor.name} loading="lazy" className="aspect-[2/3] w-full rounded-xl bg-white/5 object-cover" />
                  <span className="mt-2 block truncate text-sm font-semibold">{actor.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-white/50">{actor.character}</span>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-white/50">暂无演员资料</p>}
        </section>
      </div>

      {(person || personLoading) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-5" onClick={() => setPerson(null)}><section className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-[#151519] p-6" onClick={(event) => event.stopPropagation()}>{personLoading ? <p>正在加载人物资料…</p> : person && <><button className="float-right" onClick={() => setPerson(null)}>关闭 ✕</button><div className="flex gap-5"><img src={imageUrl(person.profile_path, 'w342')} alt={person.name} className="w-28 self-start rounded-xl" /><div><h2 className="text-2xl font-semibold">{person.name}</h2><p className="mt-2 text-sm text-white/60">{person.known_for_department} · {person.birthday || ''} · {person.place_of_birth || ''}</p></div></div><p className="mt-5 whitespace-pre-line text-sm leading-7 text-white/75">{person.biography || '暂无人物简介'}</p><h3 className="mb-3 mt-6 font-semibold">代表作品</h3><div className="flex gap-3 overflow-x-auto">{[...(person.movie_credits?.cast || []), ...(person.tv_credits?.cast || [])].slice(0, 20).map((work) => <div key={work.id + (work.title || work.name || '')} className="w-24 shrink-0"><img src={imageUrl(work.poster_path, 'w185')} alt={work.title || work.name || ''} className="aspect-[2/3] w-full rounded-lg object-cover" /><p className="mt-1 truncate text-xs">{work.title || work.name}</p></div>)}</div></>}</section></div>}
    </main>
  );
}
