'use client';

import './search.css';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { useFridayGlass } from '@/components/friday/FridayGlassProvider';
import { api } from '@/lib/client-api';
import { resolveSource, useAppStore } from '@/lib/store';
import { validateSourceUrl } from '@/lib/utils';
import type { SearchResultItem } from '@/lib/types';
import { fromCmsSearchResult } from '@/lib/poster';

function IpadSearchContent() {
  const { preferences } = useFridayGlass();
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get('q') ?? '';
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const activeController = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const ownUrlUpdate = useRef<string | null>(null);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const sources = useMemo(() => {
    const seen = new Set<string>();
    return selectedKeys.map((key) => resolveSource({ customAPIs, envSources }, key)).filter((source): source is NonNullable<typeof source> => {
      if (!source || !validateSourceUrl(source.url) || seen.has(source.key)) return false;
      seen.add(source.key);
      return true;
    });
  }, [selectedKeys, customAPIs, envSources]);
  const sourceSignature = sources.map((source) => source.key + ':' + source.url).join('|');
  const lastSourceSignature = useRef<string | null>(null);

  const runSearch = async (term: string) => {
    const value = term.trim().slice(0, 50);
    setQuery(value);
    activeController.current?.abort();
    const currentRequest = ++requestId.current;
    activeController.current = null;
    if (!value) {
      setResults([]);
      setError(''); setWarning('');
      setHasSearched(false);
      setLoading(false);
      return;
    }
    setHasSearched(true);
    setResults([]);
    setError(''); setWarning('');
    if (value !== initial) {
      ownUrlUpdate.current = value;
      router.replace('/ipad-edition/search?' + new URLSearchParams({ q: value }).toString(), { scroll: false });
    }
    if (!sources.length) {
      setError('尚未启用可用的点播源，请先在 LibreTV 设置中添加或启用资源源。');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    activeController.current = controller;
    setLoading(true);
    try {
      const response = await api.search(value, sources, yellowFilter, { signal: controller.signal });
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      setResults(response.list ?? []);
      const failures = response.failures ?? [];
      if (failures.length && !response.list?.length) setError('部分或全部资源源请求失败，无法确认是否存在匹配内容，请重试。');
      else if (failures.length) setWarning(`${failures.length} 个资源源请求失败，结果可能不完整。`);
    } catch (reason) {
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      setResults([]);
      setError(reason instanceof Error ? reason.message : '搜索失败，请稍后重试。');
    } finally {
      if (currentRequest === requestId.current) {
        activeController.current = null;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    // Keep search state synchronized with browser Back/Forward navigation.
    if (ownUrlUpdate.current === initial) {
      ownUrlUpdate.current = null;
      return;
    }
    ownUrlUpdate.current = null;
    if (initial.trim()) {
      void runSearch(initial);
    } else {
      activeController.current?.abort();
      activeController.current = null;
      requestId.current += 1;
      setQuery('');
      setResults([]);
      setError(''); setWarning('');
      setHasSearched(false);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // Enabled sources can change without a route change. Re-run the visible
  // query instead of continuing to show results from a stale source set.
  useEffect(() => {
    const signature = sourceSignature + ':' + yellowFilter;
    if (lastSourceSignature.current === null) {
      lastSourceSignature.current = signature;
      return;
    }
    if (lastSourceSignature.current === signature) return;
    lastSourceSignature.current = signature;
    if (initial.trim() && hasSearched) void runSearch(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSignature, yellowFilter]);

  useEffect(() => () => activeController.current?.abort(), []);

  // Poster selection is navigation-only. Resource details and playback must
  // remain behind the explicit Start Playback action on the detail page.
  const openPlayback = (item: SearchResultItem) => {
    const next = new URLSearchParams({
      source: item.sourceKey,
      id: item.vodId,
      title: item.name,
      sourceName: item.sourceName || item.sourceKey,
    });
    if (item.pic) next.set('pic', item.pic);
    if (item.sourceUrl) next.set('sourceUrl', item.sourceUrl);
    router.push('/ipad-edition/detail?' + next.toString());
  };

  const categories = [
    ['动作', '动作电影'], ['剧情', '剧情电影'], ['喜剧', '喜剧电影'], ['科幻', '科幻电影'],
    ['悬疑', '悬疑电影'], ['爱情', '爱情电影'], ['动画', '动画电影'], ['纪录片', '纪录片'],
  ];

  return (
    <div className="ipad-edition__page ipad-edition__search-page">
      <header className="ipad-edition__page-heading">
        <p className="ipad-edition__eyebrow">DISCOVER SOMETHING NEW</p>
        <h1>搜索与发现</h1>
        <p>跨已启用的点播源搜索电影、剧集与动画。</p>
      </header>
      <form className="ipad-edition__search-form" data-friday-material={preferences.material} onSubmit={(event) => { event.preventDefault(); void runSearch(query); }}>
        <span aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="10.8" cy="10.8" r="6.7" />
            <path d="m15.8 15.8 4.2 4.2" />
          </svg>
        </span>
        <input value={query} maxLength={50} onChange={(event) => { activeController.current?.abort(); activeController.current = null; requestId.current += 1; setLoading(false); setQuery(event.target.value); setHasSearched(false); setResults([]); setError(''); setWarning(''); if (!event.target.value.trim() && initial) { ownUrlUpdate.current = ''; router.replace('/ipad-edition/search', { scroll: false }); } }} placeholder="搜索片名、演员或关键词…" aria-label="搜索影视内容" />
        {query ? <button type="button" onClick={() => { activeController.current?.abort(); activeController.current = null; requestId.current += 1; setLoading(false); setQuery(''); setResults([]); setError(''); setWarning(''); setHasSearched(false); router.replace('/ipad-edition/search'); }}>清空</button> : null}
        <button type="submit" disabled={loading || !query.trim()}>{loading ? '搜索中…' : '搜索'}</button>
      </form>
      {!query.trim() ? (
        <section className="ipad-edition__category-area">
          <div className="ipad-edition__section-heading"><div><p className="ipad-edition__eyebrow">BROWSE BY GENRE</p><h2>热门分类</h2></div></div>
          <div className="ipad-edition__category-grid">{categories.map(([label, term]) => <button key={label} type="button" data-friday-material={preferences.material} onClick={() => void runSearch(term)}><span>{label}</span><small>探索相关影片</small><b aria-hidden="true">↗</b></button>)}</div>
        </section>
      ) : null}
      {error ? (
        <div className="ipad-edition__rail-message" role="alert">
          <p>{error}</p>
          {sources.length ? (
            <button type="button" onClick={() => void runSearch(query)}>重试搜索</button>
          ) : (
            <a href="/ipad-edition/settings">前往设置资源源</a>
          )}
        </div>
      ) : null}
      {warning ? <div role="status" className="ipad-edition__rail-message">{warning}</div> : null}
      {loading ? <div className="ipad-edition__rail-message" role="status">正在检索已启用的资源源…</div> : null}
      {!loading && !error && hasSearched && query.trim() && results.length === 0 ? <div className="ipad-edition__rail-message">没有找到匹配内容，试试更短的片名或其他关键词。</div> : null}
      {results.length ? (
        <section className="ipad-edition__search-results" aria-label="搜索结果">
          <div className="ipad-edition__section-heading"><div><p className="ipad-edition__eyebrow">RESULTS</p><h2>搜索结果 <small>({results.length})</small></h2></div></div>
          <div className="ipad-edition__result-grid">
            {results.map((item, index) => <button className="ipad-edition__result-card" type="button" key={item.sourceKey + ':' + item.vodId + ':' + index} onClick={() => openPlayback(item)}>
              <PosterRenderer variant="result" frameClassName="ipad-edition__result-poster" asset={fromCmsSearchResult(item)} url={item.pic} mode={imageProxyMode} customProxy={customImageProxy} alt={item.name} />
              <strong>{item.name}</strong><small>{[item.year, item.typeName, item.remarks, item.sourceName].filter(Boolean).join(' · ')}</small>
            </button>)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function IpadEditionSearchPage() {
  return <Suspense fallback={<div className="ipad-edition__rail-message">正在打开搜索…</div>}><IpadSearchContent /></Suspense>;
}
