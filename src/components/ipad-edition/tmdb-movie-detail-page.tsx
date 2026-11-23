'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { resolveSource, useAppStore, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { findMovieMatch, getMovieSearchTerms } from '@/lib/movie-title-match';
import type { SourceConfig } from '@/lib/types';

type TmdbImage = { file_path?: string; iso_639_1?: string | null; width?: number; height?: number };
type TmdbPerson = { id: number; name: string; character?: string; profile_path?: string | null; job?: string; department?: string };
type TmdbTitle = {
  id: number; title?: string; name?: string; original_title?: string; original_name?: string;
  overview?: string; poster_path?: string | null; backdrop_path?: string | null; vote_average?: number;
  release_date?: string; first_air_date?: string; runtime?: number; episode_run_time?: number[];
  genres?: { id: number; name: string }[]; production_countries?: { name: string }[];
  images?: { backdrops?: TmdbImage[]; posters?: TmdbImage[]; logos?: TmdbImage[] };
  credits?: { cast?: TmdbPerson[]; crew?: TmdbPerson[] };
};
type TmdbCredit = { id: number; title?: string; name?: string; character?: string; poster_path?: string | null; release_date?: string; first_air_date?: string };
type TmdbPersonDetails = { id: number; name: string; biography?: string; profile_path?: string | null; birthday?: string; place_of_birth?: string; known_for_department?: string; movie_credits?: { cast?: TmdbCredit[] }; tv_credits?: { cast?: TmdbCredit[] } };

const imageUrl = (path?: string | null, size = 'w780') => path ? \`https://image.tmdb.org/t/p/\${size}\${path}\` : '';

export function TmdbMovieDetailPage({ id, type, titleFallback, posterFallback, backdropFallback, ratingFallback }: {
  id: string; type: 'movie' | 'tv'; titleFallback: string; posterFallback: string; backdropFallback: string; ratingFallback: string;
}) {
  const router = useRouter();
  const selectedKeys = useAppStore((state) => state.selectedKeys);
  const customAPIs = useAppStore((state) => state.customAPIs);
  const envSources = useAppStore((state) => state.envSources);
  const sourceHealth = useAppStore((state) => state.sourceHealth);
  const subscriptions = useAppStore((state) => state.subscriptions);
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
        const response = await api.search(term, sources, false);
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
          ? \`没有匹配到影片资源；另有 \${failures.size} 个点播源请求失败，请检查源状态后重试。\`
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
  const poster = imageUrl(movie?.poster_path, 'w500') || posterFallback;
  const backdrop = imageUrl(movie?.backdrop_path, 'w1280') || backdropFallback || poster;
  const cast = movie?.credits?.cast?.slice(0, 18) || [];
  const crew = (movie?.credits?.crew || []).filter((entry) => ['Director', 'Writer', 'Screenplay', 'Producer', 'Director of Photography'].includes(entry.job || '')).slice(0, 12);
  const stills = (movie?.images?.backdrops || []).filter((entry) => entry.file_path).slice(0, 18);
  const posters = (movie?.images?.posters || []).filter((entry) => entry.file_path).slice(0, 12);

  if (loading) return <main className="min-h-screen bg-[#08080a] p-10 text-white">正在加载电影资料…</main>;
  if (!movie) return <main className="min-h-screen bg-[#08080a] p-10 text-white"><button onClick={() => router.back()}>‹ 返回</button><p className="mt-8">{metadataError || '电影资料暂时不可用'}</p></main>;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#08080a] pb-24 text-white">
      <section className="relative flex min-h-[620px] items-end overflow-hidden px-7 pb-16 pt-24 md:min-h-[760px] md:px-16">
        <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/65 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#08080a] via-transparent to-black/20" />
        <button onClick={() => router.back()} className="absolute left-7 top-8 z-10 rounded-full border border-white/20 bg-black/40 px-4 py-2 backdrop-blur">‹ 返回</button>
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-end gap-6">
            <img src={poster} alt={title + ' 海报'} className="hidden w-36 rounded-xl shadow-2xl md:block" />
            <div>
              <p className="mb-3 text-xs uppercase tracking-[.25em] text-white/60">LIBRETV · TITLE DETAILS</p>
              <h1 className="text-4xl font-bold tracking-tight md:text-6xl">{title}</h1>
              <p className="mt-3 text-sm text-white/70">{movie.original_title || movie.original_name} · {(movie.release_date || movie.first_air_date || '').slice(0, 4)} · {movie.genres?.map((genre) => genre.name).join(' / ')} · ★ {(movie.vote_average || Number(ratingFallback) || 0).toFixed(1)}</p>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/80">{movie.overview || '暂无剧情简介'}</p>
            </div>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void startPlayback()} disabled={startingPlayback} className="rounded-full bg-white px-7 py-3 font-semibold text-black disabled:opacity-50">
              {startingPlayback ? '正在查找资源…' : '▶ 开始播放'}
            </button>
            <span className="max-w-xl rounded-full border border-white/20 bg-black/30 px-5 py-3 text-sm text-white/75" role="status" aria-live="polite">{playbackStatus}</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1500px] px-7 py-8 md:px-16">
        <h2 className="mb-4 text-2xl font-semibold">剧照</h2>
        <div className="flex gap-4 overflow-x-auto pb-4">{stills.map((still, index) => <img key={still.file_path} src={imageUrl(still.file_path, 'w780')} alt={title + ' 剧照 ' + (index + 1)} className="w-[280px] shrink-0 rounded-xl object-cover" />)}</div>
        <h2 className="mb-4 mt-8 text-2xl font-semibold">演员</h2>
        <div className="flex gap-4 overflow-x-auto pb-4">{cast.map((actor) => <button key={actor.id} onClick={() => void openPerson(actor.id)} className="w-32 shrink-0 text-left"><img src={imageUrl(actor.profile_path, 'w185') || '/placeholder.svg'} alt={actor.name} className="aspect-[2/3] w-full rounded-xl object-cover" /><span className="mt-2 block truncate text-sm font-semibold">{actor.name}</span><span className="block truncate text-xs text-white/55">{actor.character}</span></button>)}</div>
        <h2 className="mb-4 mt-8 text-2xl font-semibold">导演与制作团队</h2>
        <div className="flex flex-wrap gap-3">{crew.map((member) => <button key={member.id + (member.job || '')} onClick={() => void openPerson(member.id)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left"><span className="block font-medium">{member.name}</span><span className="text-xs text-white/55">{member.job}</span></button>)}</div>
        <h2 className="mb-4 mt-8 text-2xl font-semibold">海报与宣传图</h2>
        <div className="flex gap-4 overflow-x-auto pb-4">{posters.map((art, index) => <img key={art.file_path} src={imageUrl(art.file_path, 'w500')} alt={title + ' 海报 ' + (index + 1)} className="w-36 shrink-0 rounded-xl object-cover" />)}</div>
        <div className="mt-8 flex flex-wrap gap-6 text-sm text-white/65"><span>片长：{movie.runtime ? movie.runtime + ' 分钟' : movie.episode_run_time?.[0] ? movie.episode_run_time[0] + ' 分钟/集' : '暂无数据'}</span><span>国家/地区：{movie.production_countries?.map((country) => country.name).join('、') || '暂无数据'}</span><span>评分：{(movie.vote_average || 0).toFixed(1)} / 10</span></div>
      </section>

      {(person || personLoading) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-5" onClick={() => setPerson(null)}><section className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-[#151519] p-6" onClick={(event) => event.stopPropagation()}>{personLoading ? <p>正在加载人物资料…</p> : person && <><button className="float-right" onClick={() => setPerson(null)}>关闭 ✕</button><div className="flex gap-5"><img src={imageUrl(person.profile_path, 'w342')} alt={person.name} className="w-28 self-start rounded-xl" /><div><h2 className="text-2xl font-semibold">{person.name}</h2><p className="mt-2 text-sm text-white/60">{person.known_for_department} · {person.birthday || ''} · {person.place_of_birth || ''}</p></div></div><p className="mt-5 whitespace-pre-line text-sm leading-7 text-white/75">{person.biography || '暂无人物简介'}</p><h3 className="mb-3 mt-6 font-semibold">代表作品</h3><div className="flex gap-3 overflow-x-auto">{[...(person.movie_credits?.cast || []), ...(person.tv_credits?.cast || [])].slice(0, 20).map((work) => <div key={work.id + (work.title || work.name || '')} className="w-24 shrink-0"><img src={imageUrl(work.poster_path, 'w185')} alt={work.title || work.name || ''} className="aspect-[2/3] w-full rounded-lg object-cover" /><p className="mt-1 truncate text-xs">{work.title || work.name}</p></div>)}</div></>}</section></div>}
    </main>
  );
}
