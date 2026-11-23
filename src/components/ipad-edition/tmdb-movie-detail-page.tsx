'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { resolveSource, useAppStore, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import type { SourceConfig, VideoDetail } from '@/lib/types';

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
type TmdbPersonDetails = { id: number; name: string; biography?: string; profile_path?: string | null; birthday?: string; place_of_birth?: string; known_for_department?: string; movie_credits?: { cast?: { id: number; title?: string; character?: string; poster_path?: string | null; release_date?: string }[] }; tv_credits?: { cast?: { id: number; name?: string; character?: string; poster_path?: string | null; first_air_date?: string }[] } };

const imageUrl = (path?: string | null, size = 'w780') => path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
const normalize = (value: string) => value.replace(/[\\s\\p{P}\\p{S}]/gu, '').toLocaleLowerCase();

export function TmdbMovieDetailPage({ id, type, titleFallback, posterFallback, ratingFallback }: {
  id: string; type: 'movie' | 'tv'; titleFallback: string; posterFallback: string; ratingFallback: string;
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
  const [resources, setResources] = useState<{ item: any; source: SourceConfig }[]>([]);
  const [resourceStatus, setResourceStatus] = useState('正在搜索可用播放资源…');
  const [activeResource, setActiveResource] = useState<{ item: any; source: SourceConfig } | null>(null);
  const [cmsDetail, setCmsDetail] = useState<VideoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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

  useEffect(() => {
    if (!sources.length) {
      setResources([]);
      setResourceStatus('尚未启用点播源。影片资料仍可正常浏览，请在设置中启用播放源。');
      return;
    }
    const controller = new AbortController();
    setResourceStatus('正在搜索已启用的点播源…');
    api.search(titleFallback, sources, yellowFilter, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const exact = response.list.filter((entry) => normalize(entry.name) === normalize(titleFallback));
        const found = exact.length ? exact : response.list.filter((entry) => {
          const a = normalize(entry.name); const b = normalize(titleFallback);
          return a.includes(b) || b.includes(a);
        });
        const mapped = found.map((item) => ({ item, source: sources.find((source) => source.key === item.sourceKey)! }))
          .filter((entry) => entry.source);
        setResources(mapped);
        setResourceStatus(mapped.length ? `找到 ${mapped.length} 个可用播放资源` : '暂未找到匹配的播放资源。电影资料和剧照仍可正常查看。');
      })
      .catch((error) => { if (!controller.signal.aborted) setResourceStatus(error instanceof Error ? error.message : '播放资源搜索失败'); });
    return () => controller.abort();
  }, [titleFallback, sources, yellowFilter]);

  const chooseResource = useCallback(async (entry: { item: any; source: SourceConfig }) => {
    setActiveResource(entry);
    setCmsDetail(null);
    setDetailLoading(true);
    try {
      const result = await api.detail(entry.item.vodId, entry.source);
      setCmsDetail(result);
    } catch (error) {
      setResourceStatus(error instanceof Error ? error.message : '获取播放详情失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const play = (index: number) => {
    if (!activeResource || !cmsDetail?.episodes[index]) return;
    router.push(buildWatchUrl({
      sourceKey: activeResource.source.key,
      vodId: activeResource.item.vodId,
      index,
      title: movie?.title || movie?.name || titleFallback,
      sourceUrl: activeResource.source.url,
    }).replace('/watch?', '/ipad-edition/watch?'));
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
  const backdrop = imageUrl(movie?.backdrop_path, 'w1280') || poster;
  const cast = movie?.credits?.cast?.slice(0, 18) || [];
  const crew = (movie?.credits?.crew || []).filter((entry) => ['Director', 'Writer', 'Screenplay', 'Producer', 'Director of Photography'].includes(entry.job || '')).slice(0, 12);
  const stills = (movie?.images?.backdrops || []).filter((entry) => entry.file_path).slice(0, 18);
  const posters = (movie?.images?.posters || []).filter((entry) => entry.file_path).slice(0, 12);
  const episodes = cmsDetail?.episodes || [];
  const episodeItems = cmsDetail?.episodeItems || [];

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
          <div className="mt-7 flex flex-wrap gap-3">
            <button onClick={() => resources[0] && void chooseResource(resources[0])} disabled={!resources.length} className="rounded-full bg-white px-7 py-3 font-semibold text-black disabled:opacity-40">选择播放资源</button>
            <span className="rounded-full border border-white/20 bg-black/30 px-5 py-3 text-sm">{resourceStatus}</span>
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
        <h2 className="mb-4 mt-10 text-2xl font-semibold">播放资源与选集</h2>
        <p className="mb-4 text-sm text-white/60">{resourceStatus}</p>
        <div className="flex flex-wrap gap-3">{resources.map((entry, index) => <button key={entry.item.sourceKey + entry.item.vodId} onClick={() => void chooseResource(entry)} className={'rounded-full border px-5 py-3 text-sm ' + (activeResource?.item.vodId === entry.item.vodId ? 'border-white bg-white text-black' : 'border-white/20 bg-white/5')}>{entry.item.sourceName || entry.source.name || '播放源 ' + (index + 1)} · {entry.item.name}</button>)}</div>
        {detailLoading && <p className="mt-4 text-sm text-white/60">正在读取分集…</p>}
        {episodes.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{episodes.map((episode, index) => <button key={episode + index} onClick={() => play(index)} className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm">▶ {episodeItems[index]?.title || '第 ' + (index + 1) + ' 集'}</button>)}</div>}
        {activeResource && !detailLoading && !episodes.length && <p className="mt-4 text-sm text-amber-200">该资源暂未返回可播放的分集信息，请尝试其他播放源。</p>}
        <div className="mt-8 flex flex-wrap gap-6 text-sm text-white/65"><span>片长：{movie.runtime ? movie.runtime + ' 分钟' : movie.episode_run_time?.[0] ? movie.episode_run_time[0] + ' 分钟/集' : '暂无数据'}</span><span>国家/地区：{movie.production_countries?.map((country) => country.name).join('、') || '暂无数据'}</span><span>评分：{(movie.vote_average || 0).toFixed(1)} / 10</span></div>
      </section>

      {(person || personLoading) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-5" onClick={() => setPerson(null)}><section className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-[#151519] p-6" onClick={(event) => event.stopPropagation()}>{personLoading ? <p>正在加载人物资料…</p> : person && <><button className="float-right" onClick={() => setPerson(null)}>关闭 ✕</button><div className="flex gap-5"><img src={imageUrl(person.profile_path, 'w342')} alt={person.name} className="w-28 self-start rounded-xl" /><div><h2 className="text-2xl font-semibold">{person.name}</h2><p className="mt-2 text-sm text-white/60">{person.known_for_department} · {person.birthday || ''} · {person.place_of_birth || ''}</p></div></div><p className="mt-5 whitespace-pre-line text-sm leading-7 text-white/75">{person.biography || '暂无人物简介'}</p><h3 className="mb-3 mt-6 font-semibold">代表作品</h3><div className="flex gap-3 overflow-x-auto">{[...(person.movie_credits?.cast || []), ...(person.tv_credits?.cast || [])].slice(0, 20).map((work) => <div key={work.id + (work.title || work.name || '')} className="w-24 shrink-0"><img src={imageUrl(work.poster_path, 'w185')} alt={work.title || work.name || ''} className="aspect-[2/3] w-full rounded-lg object-cover" /><p className="mt-1 truncate text-xs">{work.title || work.name}</p></div>)}</div></>}</section></div>}
    </main>
  );
}
