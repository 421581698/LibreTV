'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db, addFavorite, removeFavorite } from '@/lib/db';
import { favoriteIdFor } from '@/lib/favorite-id';
import { useLiveQuery } from 'dexie-react-hooks';
import { api } from '@/lib/client-api';
import { SmartImage } from '@/components/smart-image';
import { IpadCinemaDetailLayout } from '@/components/ipad-edition/IpadCinemaDetailLayout';
import { selectCinemaTitleLogo } from '@/lib/ipad-edition/cinema-artwork-policy';
import { IpadCinemaCastRow } from '@/components/ipad-edition/IpadCinemaCastRow';
import { resolveSource, useAppStore, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { findMovieMatch, getMovieSearchTerms } from '@/lib/movie-title-match';
import { matchesIpadMovieIdentity } from '@/lib/ipad-edition/movie-identity';
import { rankMovieCandidatesByQuality } from '@/lib/playback-telemetry';
import type { SearchResultItem, SourceConfig } from '@/lib/types';

type TmdbPerson = { id: number; name: string; character?: string; profile_path?: string | null; job?: string };
type TmdbTitle = {
  id: number; title?: string; name?: string; original_title?: string; original_name?: string;
  overview?: string; poster_path?: string | null; backdrop_path?: string | null; vote_average?: number;
  images?: { logos?: { file_path?: string | null; iso_639_1?: string | null; width?: number; height?: number; vote_average?: number }[]; backdrops?: { file_path?: string | null; iso_639_1?: string | null; width?: number; height?: number; vote_average?: number }[] };
  videos?: { results?: { key?: string; site?: string; type?: string; official?: boolean; name?: string }[] };
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
  const [playbackStatus, setPlaybackStatus] = useState('');
  const [person, setPerson] = useState<TmdbPersonDetails | null>(null);
  const [personLoading, setPersonLoading] = useState(false);
  const favoriteSource = `tmdb:${type}`;
  const saved = useLiveQuery(async () => Boolean(await db.favorites.get(favoriteIdFor(favoriteSource, id))), [favoriteSource, id]);
  const [saving, setSaving] = useState(false);
  const personRequest = useRef<AbortController | null>(null);
  const playbackRequest = useRef<AbortController | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => () => { personRequest.current?.abort(); playbackRequest.current?.abort(); }, []);

  const sources = useMemo(() => selectedKeys.map((key) => resolveSource({ customAPIs, envSources }, key))
    .filter((source): source is SourceConfig => Boolean(source && validateSourceUrl(source.url)
      && !isSourceDisabled({ sourceHealth }, source.key)
      && !isInDisabledSubscription({ subscriptions }, source.key))),
  [selectedKeys, customAPIs, envSources, sourceHealth, subscriptions]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setMetadataError('');
    setMovie(null);
    fetch('/api/tmdb/details?' + new URLSearchParams({ id, type }), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || '无法获取影片资料');
        return response.json() as Promise<TmdbTitle>;
      })
      .then((value) => { if (!controller.signal.aborted) setMovie(value); })
      .catch((error) => { if (!controller.signal.aborted) setMetadataError(error instanceof Error ? error.message : '无法获取影片资料'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, type, retry]);

  useEffect(() => {
    if (!movie) return;
    const key = `libretv:watchlist:${type}:${id}`;
    void (async () => {
      try {
        if (localStorage.getItem(key) !== '1') return;
        await addFavorite({ sourceKey: favoriteSource, sourceName: 'TMDB', vodId: id, title: movie.title || movie.name || titleFallback, pic: imageUrl(movie.poster_path) || posterFallback });
        localStorage.removeItem(key);
      } catch { setPlaybackStatus('旧片单迁移失败，请稍后重试。'); }
    })();
  }, [movie, favoriteSource, id, type, titleFallback, posterFallback]);

  const toggleSaved = async () => {
    if (saving || saved === undefined) return;
    setSaving(true);
    try {
      if (saved) await removeFavorite(favoriteSource, id);
      else await addFavorite({ sourceKey: favoriteSource, sourceName: 'TMDB', vodId: id, title: movie?.title || movie?.name || titleFallback, pic: imageUrl(movie?.poster_path) || posterFallback });
    } catch { setPlaybackStatus('片单保存失败，请重试。'); }
    finally { setSaving(false); }
  };

  const startPlayback = async () => {
    if (startingPlayback) return;
    if (!sources.length) {
      setPlaybackStatus('尚未启用可用点播源。请先在设置中启用点播源，再点击开始播放。');
      return;
    }
    const controller = new AbortController();
    playbackRequest.current?.abort();
    playbackRequest.current = controller;
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
        const response = await api.search(term, sources, yellowFilter, { signal: controller.signal });
        if (controller.signal.aborted) return;
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
        // Search all bounded title aliases before ranking verified resources.
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
      let match: (typeof matches)[number] | undefined;
      for (const candidate of ranked) {
        const entry = matches.find(({ item }) => item.sourceKey === candidate.sourceKey && item.vodId === candidate.vodId);
        if (!entry) continue;
        try {
          const source = { ...entry.source, url: entry.item.sourceUrl || entry.source.url };
          if (!validateSourceUrl(source.url)) continue;
          const detail = await api.detail(entry.item.vodId, source, controller.signal);
          if (controller.signal.aborted) return;
          const actual = detail.videoInfo?.title || '';
          if (!detail.episodes?.length || !matchesIpadMovieIdentity({
            titles: [primaryTitle, originalTitle],
            year: (movie?.release_date || movie?.first_air_date || '').slice(0, 4),
            type,
          }, {
            title: actual,
            originalTitle: detail.videoInfo?.originalTitle,
            years: [detail.videoInfo?.year, entry.item.year],
            typeNames: [detail.videoInfo?.typeName, entry.item.typeName],
          })) continue;
          if (type === 'movie' && /短剧|短劇|short drama/i.test(detail.videoInfo?.typeName || '')) continue;
          match = entry;
          break;
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (!match) throw new Error('候选资源详情与影片身份不一致或没有可播放剧集，请更换点播源。');
      setPlaybackStatus(`已比较 ${matches.length} 条候选线路，按历史播放稳定性优先排序；无历史记录的线路保留为后备。`);
      const watchUrl = buildWatchUrl({
        sourceKey: match.source.key, vodId: match.item.vodId, index: 0, title: primaryTitle,
        sourceUrl: match.item.sourceUrl || match.source.url,
      }).replace('/watch?', '/ipad-edition/watch?');
      const verifiedParams = new URLSearchParams(watchUrl.split('?')[1] || '');
      const releaseYear = (movie?.release_date || movie?.first_air_date || '').slice(0, 4);
      if (releaseYear) verifiedParams.set('identityYear', releaseYear);
      verifiedParams.set('identityType', type);
      if (originalTitle) verifiedParams.set('identityOriginalTitle', originalTitle);
      if (!controller.signal.aborted) router.push('/ipad-edition/watch?' + verifiedParams.toString());
    } catch (error) {
      if (!controller.signal.aborted) setPlaybackStatus(error instanceof Error ? error.message : '播放资源查询失败，请稍后重试。');
    } finally {
      if (!controller.signal.aborted) setStartingPlayback(false);
    }
  };

  const closePerson = () => { personRequest.current?.abort(); setPerson(null); setPersonLoading(false); };
  const openPerson = async (personId: number) => {
    personRequest.current?.abort();
    const controller = new AbortController();
    personRequest.current = controller;
    setPersonLoading(true);
    setPerson(null);
    try {
      const response = await fetch('/api/tmdb/person?' + new URLSearchParams({ id: String(personId) }), { signal: controller.signal });
      if (!response.ok) throw new Error('人物资料暂时不可用');
      const value = await response.json() as TmdbPersonDetails;
      if (!controller.signal.aborted) setPerson(value);
    } catch {
      if (!controller.signal.aborted) setPerson({ id: personId, name: '人物资料暂时不可用' });
    } finally {
      if (!controller.signal.aborted) setPersonLoading(false);
    }
  };

  const title = movie?.title || movie?.name || titleFallback;
  // Language-neutral artwork is a useful signal for text-free backdrops, not a guarantee.
  const neutralBackdrop = (movie?.images?.backdrops || [])
    .filter((item) => item.iso_639_1 === null &&
      typeof item.file_path === 'string' && /^\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(item.file_path) &&
      (item.width || 0) >= 1280 && (item.height || 0) >= 720 &&
      (item.width || 0) / (item.height || 1) >= 1.5)
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) ||
      (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0]?.file_path;
  const backdrop = imageUrl(neutralBackdrop || movie?.backdrop_path || backdropFallback, 'original');
  const poster = imageUrl(movie?.poster_path, 'original') || posterFallback;
  const cast = movie?.credits?.cast?.slice(0, 18) || [];
  const director = movie?.credits?.crew?.find((member) => member.job === 'Director')?.name;
  const releaseYear = (movie?.release_date || movie?.first_air_date || '').slice(0, 4);
  const runtime = movie?.runtime || movie?.episode_run_time?.[0];
  const rating = movie?.vote_average || Number(ratingFallback) || 0;
  const logo = selectCinemaTitleLogo(movie?.images?.logos);
  const leadingCast = cast.slice(0, 3).map((member) => member.name).filter(Boolean).join('、');
  const trailers = movie?.videos?.results || [];
  const trailer = trailers.find((item) => item.site === 'YouTube' && item.type === 'Trailer' && item.official && /^[A-Za-z0-9_-]{11}$/.test(item.key || ''))
    || trailers.find((item) => item.site === 'YouTube' && item.type === 'Trailer' && /^[A-Za-z0-9_-]{11}$/.test(item.key || ''));
  const trailerUrl = trailer?.key ? `https://www.youtube.com/watch?v=${trailer.key}` : '';


  if (loading) return <main className="ipad-detail-state">正在加载电影资料…</main>;
  if (!movie) return <main className="ipad-detail-state"><button type="button" onClick={() => router.back()}>‹ 返回</button><p>{metadataError || '电影资料暂时不可用'}</p><button type="button" onClick={() => setRetry((n) => n + 1)}>重试</button></main>;

  return (
    <IpadCinemaDetailLayout
      title={title}
      eyebrow={type === 'tv' ? 'SERIES' : 'FEATURE FILM'}
      backdropUrl={backdrop}
      posterUrl={poster || undefined}
      backdropFallbackUrl={neutralBackdrop ? imageUrl(movie?.backdrop_path || backdropFallback, 'original') : movie?.backdrop_path ? backdropFallback : undefined}
      imageMode={imageProxyMode}
      customImageProxy={customImageProxy}
      originalTitle={movie.original_title || movie.original_name || undefined}
      titleLogoUrl={logo ? imageUrl(logo, 'w500') : undefined}
      credits={(leadingCast || director) ? <>
        {leadingCast ? <p><span>主演</span>{leadingCast}</p> : null}
        {director ? <p><span>导演</span>{director}</p> : null}
      </> : undefined}
      metadata={
        <>
          {movie.genres?.slice(0, 3).map((genre) => <span key={genre.id}>{genre.name}</span>)}
          {movie.genres?.length ? <i aria-hidden="true">·</i> : null}
          {rating > 0 && <span className="ipad-cinema-rating">★ {rating.toFixed(1)} / 10</span>}
          {releaseYear && <span>{releaseYear}</span>}
          {runtime && <span>{runtime} 分钟{type === 'tv' ? '/集' : ''}</span>}
        </>
      }
      overview={movie.overview || undefined}
      actions={
        <>
          <button type="button" onClick={() => void startPlayback()} disabled={startingPlayback} className="ipad-cinema-play" aria-label="▶ 开始播放">
            {startingPlayback ? '正在查找资源…' : '▶ 开始播放'}
          </button>
          <button type="button" onClick={() => void toggleSaved()} disabled={saving || saved === undefined} className="ipad-cinema-add" aria-label={saved ? '从片单移除' : '加入片单'} aria-pressed={saved}>
            {saved ? '✓' : '+'}
          </button>
          {playbackStatus ? <span className="ipad-cinema-status" role="status" aria-live="polite">{playbackStatus}</span> : null}
        </>
      }
      onBack={() => router.back()}
    >
      {trailerUrl ? (
        <section className="ipad-cinema-trailers ipad-cinema-section" aria-label="预告片">
          <h2>预告片</h2>
          <a className="ipad-cinema-trailer" href={trailerUrl} target="_blank" rel="noopener noreferrer" aria-label="在 YouTube 打开影片预告片">
            <SmartImage url={backdrop || poster || ''} mode={imageProxyMode} customProxy={customImageProxy} alt="预告片封面" loading="lazy" showDefaultFallback={false} />
            <span aria-hidden="true">▶</span>
            <strong>{trailer?.name || '观看预告片'}</strong>
          </a>
        </section>
      ) : null}
      <section className="ipad-cinema-info" aria-label="影片资料">
        <dl>
          <div><dt>年份</dt><dd>{releaseYear || '暂无数据'}</dd></div>
          <div><dt>类型</dt><dd>{movie.genres?.map((genre) => genre.name).join('、') || '暂无数据'}</dd></div>
          <div><dt>片长</dt><dd>{runtime ? `${runtime} 分钟${type === 'tv' ? '/集' : ''}` : '暂无数据'}</dd></div>
          <div><dt>国家/地区</dt><dd>{movie.production_countries?.map((country) => country.name).join('、') || '暂无数据'}</dd></div>
        </dl>
      </section>
      <IpadCinemaCastRow
        actors={cast.map((actor) => ({ id: actor.id, name: actor.name, role: actor.character, imageUrl: imageUrl(actor.profile_path, 'w342') }))}
        imageMode={imageProxyMode}
        customImageProxy={customImageProxy}
        onSelect={openPerson}
      />
      {(person || personLoading) && <div className="ipad-cinema-person-backdrop" onClick={closePerson}>
        <section className="ipad-cinema-person" onClick={(event) => event.stopPropagation()}>
          {personLoading ? <p>正在加载人物资料…</p> : person && <>
            <button type="button" className="ipad-cinema-person__close" onClick={closePerson}>关闭 ✕</button>
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
