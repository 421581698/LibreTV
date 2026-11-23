'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { SmartImage } from '@/components/smart-image';
import { IpadCinemaDetailLayout } from '@/components/ipad-edition/IpadCinemaDetailLayout';
import { resolveSource, useAppStore, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { findMovieMatch, getMovieSearchTerms } from '@/lib/movie-title-match';
import { rankMovieCandidatesByQuality } from '@/lib/playback-telemetry';
import type { SearchResultItem, SourceConfig } from '@/lib/types';

type TmdbPerson = { id: number; name: string; character?: string; profile_path?: string | null; job?: string };
type TmdbTitle = {
  id: number; title?: string; name?: string; original_title?: string; original_name?: string;
  overview?: string; poster_path?: string | null; backdrop_path?: string | null; vote_average?: number;
  release_date?: string; first_air_date?: string; runtime?: number; episode_run_time?: number[];
  genres?: { id: number; name: string }[];
  production_countries?: { name: string }[];
  credits?: { cast?: TmdbPerson[]; crew?: TmdbPerson[] };
};
type TmdbCredit = { id: number; title?: string; name?: string; poster_path?: string | null };
type TmdbPersonDetails = { id: number; name: string; biography?: string; profile_path?: string | null; birthday?: string; place_of_birth?: string; known_for_department?: string; movie_credits?: { cast?: TmdbCredit[] }; tv_credits?: { cast?: TmdbCredit[] } };

const imageUrl = (path?: string | null, size = 'w780') => path
  ? path.startsWith('https://') || path.startsWith('http://') ? path : `https://image.tmdb.org/t/p/${size}${path}`
  : '';

export function TmdbMovieDetailPage({ id, type, titleFallback, posterFallback, backdropFallback, ratingFallback }: {
  id: string; type: 'movie' | 'tv'; titleFallback: string; posterFallback: string; backdropFallback: string; ratingFallback: string;
}) {
  const router = useRouter();
  const selectedKeys = useAppStore((state) => state.selectedKeys);
  const customAPIs = useAppStore((state) => state.customAPIs);
  const envSources = useAppStore((state) => state.envSources);
  const sourceHealth = useAppStore((state) => state.sourceHealth);
  const subscriptions = useAppStore((state) => state.subscriptions);
  const yellowFilter = useAppStore((state) => state.yellowFilter);
  const playbackHealth = useAppStore((state) => state.playbackHealth);
  const playbackResourceHealth = useAppStore((state) => state.playbackResourceHealth);
  const qualityMap = useAppStore((state) => state.qualityMap);
  const imageProxyMode = useAppStore((state) => state.imageProxyMode);
  const customImageProxy = useAppStore((state) => state.customImageProxy);
  const [movie, setMovie] = useState<TmdbTitle | null>(null);
  const [loading, setLoading] = useState(true);
  const [metadataError, setMetadataError] = useState('');
  const [startingPlayback, setStartingPlayback] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState('点击「开始播放」后才会查询已启用的点播源。');
  const [person, setPerson] = useState<TmdbPersonDetails | null>(null);
  const [personLoading, setPersonLoading] = useState(false);
  const [saved, setSaved] = useState(false);

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

  useEffect(() => {
    try { setSaved(window.localStorage.getItem(`libretv:watchlist:${type}:${id}`) === '1'); } catch { setSaved(false); }
  }, [id, type]);

  const toggleSaved = () => {
    const next = !saved;
    setSaved(next);
    try {
      const key = `libretv:watchlist:${type}:${id}`;
      if (next) window.localStorage.setItem(key, '1');
      else window.localStorage.removeItem(key);
    } catch { /* The control remains usable for this session when storage is unavailable. */ }
  };

  const startPlayback = async () => {
    if (startingPlayback) return;
    if (!sources.length) {
      setPlaybackStatus('尚未启用可用点播源。请先在设置中启用点播源，再点击开始播放。');
      return;
    }
    setStartingPlayback(true);
    setPlaybackStatus('正在查找资源并评估历史播放流畅度…');
    try {
      const primaryTitle = movie?.title || movie?.name || titleFallback;
      const originalTitle = movie?.original_title || movie?.original_name || '';
      const terms = [...new Set([
        ...getMovieSearchTerms(primaryTitle),
        ...(originalTitle ? getMovieSearchTerms(originalTitle) : []),
      ])];
      const matches: Array<{ item: SearchResultItem; source: SourceConfig }> = [];
      const seen = new Set<string>();
      const failures = new Set<string>();
      for (const term of terms) {
        const response = await api.search(term, sources, yellowFilter);
        response.failures.forEach((failure) => failures.add(failure.sourceKey));
        for (const item of response.list) {
          if (!findMovieMatch(primaryTitle, [item]) && !findMovieMatch(term, [item])) continue;
          const source = sources.find((candidate) => candidate.key === item.sourceKey);
          if (!source) continue;
          const key = `${item.sourceKey}:${item.vodId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          matches.push({ item, source });
        }
        if (matches.length) break;
      }
      if (!matches.length) {
        setPlaybackStatus(failures.size
          ? `没有匹配到影片资源；另有 ${failures.size} 个点播源请求失败，请检查源状态后重试。`
          : '暂未找到匹配的播放资源。影片资料仍可继续浏览，请稍后重试或检查点播源。');
        return;
      }
      const ranked = rankMovieCandidatesByQuality(
        matches.map(({ item }) => item), qualityMap, playbackHealth, Date.now(), playbackResourceHealth,
      );
      const best = ranked[0];
      const match = matches.find(({ item }) => item.sourceKey === best.sourceKey && item.vodId === best.vodId);
      if (!match) throw new Error('无法确定可用播放线路，请重试。');
      setPlaybackStatus(`已比较 ${matches.length} 条候选线路，按历史播放稳定性优先排序；无历史记录的线路保留为后备。`);
      const watchUrl = buildWatchUrl({
        sourceKey: match.source.key, vodId: match.item.vodId, index: 0, title: primaryTitle,
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
  const backdrop = imageUrl(movie?.backdrop_path || backdropFallback, 'original');
  const poster = imageUrl(movie?.poster_path, 'original') || posterFallback;
  const cast = movie?.credits?.cast?.slice(0, 18) || [];
  const director = movie?.credits?.crew?.find((member) => member.job === 'Director')?.name;
  const releaseYear = (movie?.release_date || movie?.first_air_date || '').slice(0, 4);
  const runtime = movie?.runtime || movie?.episode_run_time?.[0];
  const rating = movie?.vote_average || Number(ratingFallback) || 0;

  if (loading) return <main className="ipad-detail-state">正在加载电影资料…</main>;
  if (!movie) return <main className="ipad-detail-state"><button type="button" onClick={() => router.back()}>‹ 返回</button><p>{metadataError || '电影资料暂时不可用'}</p></main>;

  return (
    <IpadCinemaDetailLayout
      title={title}
      eyebrow={type === 'tv' ? 'SERIES' : 'FEATURE FILM'}
      backdropUrl={backdrop}
      posterUrl={poster || undefined}
      backdropFallbackUrl={movie?.backdrop_path ? backdropFallback : undefined}
      imageMode={imageProxyMode}
      customImageProxy={customImageProxy}
      originalTitle={movie.original_title || movie.original_name || undefined}
      metadata={
        <>
          {movie.genres?.slice(0, 3).map((genre) => <span key={genre.id}>{genre.name}</span>)}
          {movie.genres?.length ? <i aria-hidden="true">·</i> : null}
          {rating > 0 && <span className="ipad-cinema-rating">★ {rating.toFixed(1)} / 10</span>}
          {releaseYear && <span>{releaseYear}</span>}
          {runtime && <span>{runtime} 分钟{type === 'tv' ? '/集' : ''}</span>}
        </>
      }
      overview={movie.overview || '暂无剧情简介'}
      actions={
        <>
          <button type="button" onClick={() => void startPlayback()} disabled={startingPlayback} className="ipad-cinema-play" aria-label="▶ 开始播放">
            {startingPlayback ? '正在查找资源…' : '▶ 开始播放'}
          </button>
          <button type="button" onClick={toggleSaved} className="ipad-cinema-add" aria-label={saved ? '从片单移除' : '加入片单'} aria-pressed={saved}>
            {saved ? '✓' : '+'}
          </button>
          <span className="ipad-cinema-status" role="status" aria-live="polite">{playbackStatus}</span>
        </>
      }
      onBack={() => router.back()}
    >
      <section className="ipad-cinema-info">
        <div>
          <h2>剧情简介</h2>
          <p>{movie.overview || '暂无剧情简介'}</p>
        </div>
        <dl>
          <div><dt>导演</dt><dd>{director || '暂无数据'}</dd></div>
          <div><dt>年份</dt><dd>{releaseYear || '暂无数据'}</dd></div>
          <div><dt>类型</dt><dd>{movie.genres?.map((genre) => genre.name).join('、') || '暂无数据'}</dd></div>
          <div><dt>片长</dt><dd>{runtime ? `${runtime} 分钟${type === 'tv' ? '/集' : ''}` : '暂无数据'}</dd></div>
          <div><dt>国家/地区</dt><dd>{movie.production_countries?.map((country) => country.name).join('、') || '暂无数据'}</dd></div>
        </dl>
      </section>
      <section className="ipad-cinema-cast ipad-cinema-section">
        <h2>演员阵容</h2>
        {cast.length ? <div className="ipad-cinema-cast__rail">
          {cast.map((actor) => <button key={actor.id} type="button" onClick={() => void openPerson(actor.id)}>
            <SmartImage url={imageUrl(actor.profile_path, 'w342') || '/placeholder.svg'} mode={imageProxyMode} customProxy={customImageProxy} alt={actor.name} loading="lazy" />
            <strong>{actor.name}</strong><span>{actor.character}</span>
          </button>)}
        </div> : <p>暂无演员资料</p>}
      </section>
      {(person || personLoading) && <div className="ipad-cinema-person-backdrop" onClick={() => setPerson(null)}>
        <section className="ipad-cinema-person" onClick={(event) => event.stopPropagation()}>
          {personLoading ? <p>正在加载人物资料…</p> : person && <>
            <button type="button" className="ipad-cinema-person__close" onClick={() => setPerson(null)}>关闭 ✕</button>
            <div className="ipad-cinema-person__heading"><SmartImage url={imageUrl(person.profile_path, 'w500') || '/placeholder.svg'} mode={imageProxyMode} customProxy={customImageProxy} alt={person.name} /><div><h2>{person.name}</h2><p>{person.known_for_department} · {person.birthday || ''} · {person.place_of_birth || ''}</p></div></div>
            <p className="ipad-cinema-person__bio">{person.biography || '暂无人物简介'}</p>
            <h3>代表作品</h3>
            <div className="ipad-cinema-person__works">{[...(person.movie_credits?.cast || []), ...(person.tv_credits?.cast || [])].slice(0, 20).map((work) => <div key={work.id + (work.title || work.name || '')}><SmartImage url={imageUrl(work.poster_path, 'w342') || '/placeholder.svg'} mode={imageProxyMode} customProxy={customImageProxy} alt={work.title || work.name || ''} /><p>{work.title || work.name}</p></div>)}</div>
          </>}
        </section>
      </div>}
    </IpadCinemaDetailLayout>
  );
}
