'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { findMovieMatch } from '@/lib/movie-title-match';
import { SmartImage } from '@/components/smart-image';
import { IpadCinemaDetailLayout } from '@/components/ipad-edition/IpadCinemaDetailLayout';
import { createPosterAsset } from '@/lib/poster';
import { rankMovieCandidatesByQuality } from '@/lib/playback-telemetry';
import { resolveSource, useAppStore, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import type { SearchResultItem, SourceConfig } from '@/lib/types';

type BangumiSubject = {
  id: number;
  name?: string;
  name_cn?: string;
  summary?: string;
  date?: string;
  platform?: string;
  total_episodes?: number;
  images?: { large?: string; common?: string; medium?: string };
  rating?: { score?: number; total?: number };
  tags?: { name?: string; count?: number }[];
  infobox?: { key?: string; value?: unknown }[];
};

export function BangumiSubjectDetailPage({ id, titleFallback, posterFallback }: {
  id: string;
  titleFallback: string;
  posterFallback: string;
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
  const imageProxyMode = useAppStore((state) => state.imageProxyMode);
  const customImageProxy = useAppStore((state) => state.customImageProxy);
  const qualityMap = useAppStore((state) => state.qualityMap);
  const [subject, setSubject] = useState<BangumiSubject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState('点击「开始播放」后才会查询已启用的点播源。');
  const [tmdbArtwork, setTmdbArtwork] = useState<{ id: number; poster: string; backdrop: string } | null>(null);

  const sources = useMemo(() => selectedKeys
    .map((key) => resolveSource({ customAPIs, envSources }, key))
    .filter((source): source is SourceConfig => Boolean(source && validateSourceUrl(source.url)
      && !isSourceDisabled({ sourceHealth }, source.key)
      && !isInDisabledSubscription({ subscriptions }, source.key))),
  [selectedKeys, customAPIs, envSources, sourceHealth, subscriptions]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch('/api/bangumi/subject?' + new URLSearchParams({ id }), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || '无法获取新番资料');
        return response.json() as Promise<BangumiSubject>;
      })
      .then(setSubject)
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法获取新番资料'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  // Bangumi subject ID remains the authoritative anime identity. TMDB is only
  // used as a high-resolution artwork enhancement after an exact title/year match.
  useEffect(() => {
    if (!subject) return;
    const matchTitle = subject.name_cn?.trim() || subject.name?.trim() || titleFallback.trim();
    if (!matchTitle) return;
    const controller = new AbortController();
    setTmdbArtwork(null);
    const mediaType = /剧场版|电影|movie|film/i.test(subject.platform || '') ? 'movie' : 'tv';
    const params = new URLSearchParams({ title: matchTitle, type: mediaType });
    if (subject.name && subject.name !== matchTitle) params.set('alternateTitle', subject.name);
    const year = subject.date?.slice(0, 4);
    if (year && /^\d{4}$/.test(year)) params.set('year', year);
    fetch('/api/tmdb/match?' + params.toString(), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('TMDB artwork match unavailable');
        return response.json() as Promise<{ match: { id: number; posterUrl?: string; backdropUrl?: string } | null }>;
      })
      .then(async ({ match }) => {
        if (!match || !Number.isInteger(match.id) || match.id <= 0) return;
        const response = await fetch('/api/tmdb/details?' + new URLSearchParams({ id: String(match.id), type: mediaType }), { signal: controller.signal });
        if (!response.ok) throw new Error('TMDB artwork details unavailable');
        const metadata = await response.json() as { poster_path?: string | null; backdrop_path?: string | null };
        if (controller.signal.aborted) return;
        setTmdbArtwork({
          id: match.id,
          poster: metadata.poster_path ? 'https://image.tmdb.org/t/p/original' + metadata.poster_path : match.posterUrl || '',
          backdrop: metadata.backdrop_path ? 'https://image.tmdb.org/t/p/original' + metadata.backdrop_path : match.backdropUrl || '',
        });
      })
      .catch(() => { /* Bangumi artwork remains the safe fallback. */ });
    return () => controller.abort();
  }, [subject, titleFallback]);

  const startPlayback = async () => {
    if (starting) return;
    if (!sources.length) {
      setStatus('尚未启用可用点播源，请先在设置中启用点播源。');
      return;
    }
    setStarting(true);
    setStatus('正在查找资源并评估历史播放流畅度…');
    try {
      const titles = [...new Set([subject?.name_cn, subject?.name, titleFallback].filter((value): value is string => Boolean(value?.trim())))];
      const failures = new Set<string>();
      const matches: Array<{ item: SearchResultItem; source: SourceConfig }> = [];
      const seen = new Set<string>();
      for (const title of titles) {
        const response = await api.search(title, sources, yellowFilter);
        response.failures.forEach((failure) => failures.add(failure.sourceKey));
        for (const item of response.list) {
          if (!findMovieMatch(title, [item])) continue;
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
        setStatus(failures.size
          ? '没有匹配到播放资源；另有 ' + failures.size + ' 个点播源请求失败，请检查源状态后重试。'
          : '暂未找到匹配的播放资源。作品资料仍可继续浏览，请稍后重试或检查点播源。');
        return;
      }
      const ranked = rankMovieCandidatesByQuality(
        matches.map(({ item }) => item),
        qualityMap,
        playbackHealth,
        Date.now(),
        playbackResourceHealth,
      );
      const best = ranked[0];
      const match = matches.find(({ item }) => item.sourceKey === best.sourceKey && item.vodId === best.vodId);
      if (!match) throw new Error('无法确定可用播放线路，请重试。');
      setStatus(`已比较 ${matches.length} 条候选线路，按历史播放稳定性优先排序；无历史记录的线路保留为后备。`);
      router.push(buildWatchUrl({
        sourceKey: match.source.key,
        vodId: match.item.vodId,
        index: 0,
        title: subject?.name_cn || subject?.name || titleFallback,
        sourceUrl: match.item.sourceUrl || match.source.url,
      }).replace('/watch?', '/ipad-edition/watch?'));
      return;
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : '播放资源查询失败，请稍后重试。');
    } finally {
      setStarting(false);
    }
  };

  const title = subject?.name_cn || subject?.name || titleFallback;
  const poster = tmdbArtwork?.poster || subject?.images?.large || subject?.images?.common || subject?.images?.medium || posterFallback;
  const posterAsset = subject ? createPosterAsset({
    provider: tmdbArtwork?.poster ? 'tmdb' : 'bangumi',
    providerItemId: tmdbArtwork?.poster ? String(tmdbArtwork.id) : String(subject.id),
    title,
    imageUrl: poster,
    kind: 'poster',
    ...(tmdbArtwork?.poster ? { attribution: 'TMDB' } : {}),
  }) : undefined;
  const year = subject?.date?.slice(0, 4) || '';
  const tags = (subject?.tags || []).slice(0, 16).map((tag) => tag.name).filter((tag): tag is string => Boolean(tag));

  if (loading) return <main className="min-h-screen bg-[#08080a] p-10 text-white">正在加载新番资料…</main>;
  if (!subject) return <main className="min-h-screen bg-[#08080a] p-10 text-white"><button onClick={() => router.back()}>‹ 返回</button><p className="mt-8">{error || '新番资料暂时不可用'}</p></main>;

  return (
    <IpadCinemaDetailLayout
      title={title}
      eyebrow="ANIME · BANGUMI"
      backdropUrl={tmdbArtwork?.backdrop || undefined}
      imageMode={imageProxyMode}
      customImageProxy={customImageProxy}
      originalTitle={subject.name && subject.name !== title ? subject.name : undefined}
      metadata={
        <>
          {year && <span>{year}</span>}
          <span>{subject.total_episodes ? subject.total_episodes + ' 集' : '集数待定'}</span>
          <span className="ipad-cinema-rating">★ {(subject.rating?.score || 0).toFixed(1)}</span>
        </>
      }
      overview={subject.summary || '暂无剧情简介'}
      actions={
        <>
          <button type="button" onClick={() => void startPlayback()} disabled={starting} className="ipad-cinema-play">
            {starting ? '正在查找资源…' : '▶ 开始播放'}
          </button>
          <span className="ipad-cinema-status" role="status" aria-live="polite">{status}</span>
        </>
      }
      onBack={() => router.back()}
    >
      <section className="ipad-cinema-info">
        <div>
          <h2>作品资料</h2>
          <p>{subject.summary || '暂无剧情简介'}</p>
          <div className="ipad-cinema-cast__rail" style={{ marginTop: 20 }}>
            <SmartImage asset={posterAsset} url={poster} fallbackUrl={tmdbArtwork?.poster ? subject.images?.large || subject.images?.common || subject.images?.medium || posterFallback : undefined} mode={imageProxyMode} customProxy={customImageProxy} alt={title + ' 海报'} className="w-32 rounded-xl object-cover" loading="lazy" measureNaturalSize minimumWidth={1000} expectedOrientation="portrait" />
          </div>
        </div>
        <dl>
          <div><dt>年份</dt><dd>{year || '暂无数据'}</dd></div>
          <div><dt>集数</dt><dd>{subject.total_episodes || '待定'}</dd></div>
          <div><dt>放送平台</dt><dd>{subject.platform || '暂无数据'}</dd></div>
          <div><dt>评分</dt><dd>{(subject.rating?.score || 0).toFixed(1)}</dd></div>
        </dl>
      </section>
      <section className="ipad-cinema-cast">
        <h2>作品标签</h2>
        <div className="flex flex-wrap gap-2">{tags.length ? tags.map((tag) => <span key={tag} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/75">{tag}</span>) : <span className="text-sm text-white/55">暂无标签</span>}</div>
      </section>
    </IpadCinemaDetailLayout>
  );
}
