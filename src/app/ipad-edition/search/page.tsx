'use client';

import './search.css';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { api } from '@/lib/client-api';
import { resolveSource, useAppStore } from '@/lib/store';
import { validateSourceUrl } from '@/lib/utils';
import type { SearchResultItem } from '@/lib/types';
import { fromCmsSearchResult } from '@/lib/poster';

const QUICK_SEARCHES = ['星际穿越', '流浪地球', '周星驰', '宫崎骏'];

function IpadSearchContent() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get('q') ?? '';
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedSource, setSelectedSource] = useState('all');
  const activeController = useRef<AbortController | null>(null);
  const requestId = useRef(0);
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

  const sourceOptions = useMemo(
    () => Array.from(new Set(results.map((item) => item.sourceName).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [results],
  );
  const visibleResults = useMemo(
    () => selectedSource === 'all' ? results : results.filter((item) => item.sourceName === selectedSource),
    [results, selectedSource],
  );

  const cancelSearch = () => {
    activeController.current?.abort();
    activeController.current = null;
    requestId.current += 1;
    setLoading(false);
  };

  const runSearch = async (term: string) => {
    const value = term.trim().slice(0, 100);
    setQuery(value);
    cancelSearch();
    if (!value) {
      setResults([]);
      setError('');
      setHasSearched(false);
      setSelectedSource('all');
      return;
    }
    const currentRequest = requestId.current;
    setHasSearched(true);
    setResults([]);
    setError('');
    setSelectedSource('all');
    if (!sources.length) {
      setError('尚未启用可用的点播源。请先在 LibreTV 设置中添加或启用资源源。');
      return;
    }
    const controller = new AbortController();
    activeController.current = controller;
    setLoading(true);
    try {
      const response = await api.search(value, sources, yellowFilter, { signal: controller.signal });
      if (currentRequest !== requestId.current) return;
      setResults(response.list ?? []);
      const next = new URLSearchParams({ q: value });
      router.replace('/ipad-edition/search?' + next.toString(), { scroll: false });
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
    if (initial.trim()) void runSearch(initial);
    return () => {
      activeController.current?.abort();
      activeController.current = null;
      requestId.current += 1;
    };
    // Initial query is the route entry value; later searches are user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetail = (item: SearchResultItem) => {
    const next = new URLSearchParams({ source: item.sourceKey, id: item.vodId, title: item.name, sourceName: item.sourceName });
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
      <header className="ipad-search-hero">
        <div className="ipad-search-hero__copy">
          <p className="ipad-edition__eyebrow">LIBRETV · DISCOVER</p>
          <h1>{hasSearched ? '找到下一部想看的' : '想看什么，现在就搜'}</h1>
          <p>跨已启用的资源源，发现电影、剧集与动画。</p>
        </div>
        <form className="ipad-edition__search-form" role="search" onSubmit={(event) => { event.preventDefault(); void runSearch(query); }}>
          <span aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="10.8" cy="10.8" r="6.7" />
              <path d="m15.8 15.8 4.2 4.2" />
            </svg>
          </span>
          <input
            value={query}
            maxLength={100}
            onChange={(event) => {
              cancelSearch();
              setQuery(event.target.value);
              setHasSearched(false);
              setResults([]);
              setError('');
              setSelectedSource('all');
            }}
            placeholder="搜索片名、演员、导演或关键词"
            aria-label="搜索影视内容"
          />
          {query ? <button className="ipad-search-clear" type="button" onClick={() => {
            cancelSearch();
            setQuery('');
            setResults([]);
            setError('');
            setHasSearched(false);
            setSelectedSource('all');
            router.replace('/ipad-edition/search');
          }}>清空</button> : null}
          <button className="ipad-search-submit" type="submit" disabled={loading || !query.trim()}>
            {loading ? '搜索中' : '搜索'}
          </button>
        </form>
      </header>

      {!hasSearched && !query.trim() ? (
        <section className="ipad-search-discovery" aria-label="搜索灵感">
          <div className="ipad-search-quick">
            <span>试试这些</span>
            <div className="ipad-search-quick__items">
              {QUICK_SEARCHES.map((term) => <button key={term} type="button" onClick={() => void runSearch(term)}>{term}</button>)}
            </div>
          </div>
          <div className="ipad-search-section-heading">
            <div><p className="ipad-edition__eyebrow">BROWSE BY GENRE</p><h2>按类型探索</h2></div>
            <span>选择一个方向，开始发现</span>
          </div>
          <div className="ipad-edition__category-grid">
            {categories.map(([label, term], index) => (
              <button key={label} type="button" onClick={() => void runSearch(term)}>
                <span>{label}</span><small>探索相关影片</small><b aria-hidden="true">{['01', '02', '03', '04', '05', '06', '07', '08'][index]}</b>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="ipad-search-state" role="status">
          <span className="ipad-search-state__spinner" aria-hidden="true" />
          <div><strong>正在全源检索</strong><p>正在查询已启用的资源源，请稍候…</p></div>
        </div>
      ) : null}
      {error ? (
        <div className="ipad-search-state ipad-search-state--error" role="alert">
          <div><strong>暂时无法完成搜索</strong><p>{error}</p></div>
          {query.trim() ? <button type="button" onClick={() => void runSearch(query)}>重试</button> : null}
        </div>
      ) : null}
      {!loading && !error && hasSearched && results.length === 0 ? (
        <div className="ipad-search-state ipad-search-state--empty">
          <span className="ipad-search-state__empty-mark" aria-hidden="true">⌕</span>
          <div><strong>没有找到匹配内容</strong><p>试试更短的片名、演员名字，或换一个关键词。</p></div>
        </div>
      ) : null}

      {results.length > 0 ? (
        <section className="ipad-edition__search-results" aria-label="搜索结果">
          <div className="ipad-search-results-heading">
            <div><p className="ipad-edition__eyebrow">YOUR RESULTS</p><h2>搜索结果 <span>{visibleResults.length}</span></h2><p>共找到 {results.length} 条内容 · 来自 {sourceOptions.length} 个资源源</p></div>
            {sourceOptions.length > 1 ? (
              <label className="ipad-search-source-filter">
                <span>资源来源</span>
                <select value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)}>
                  <option value="all">全部来源</option>
                  {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {visibleResults.length > 0 ? (
            <div className="ipad-edition__result-grid">
              {visibleResults.map((item, index) => (
                <button className="ipad-edition__result-card" type="button" key={item.sourceKey + ':' + item.vodId + ':' + index} onClick={() => openDetail(item)}>
                  <PosterRenderer variant="result" frameClassName="ipad-edition__result-poster" asset={fromCmsSearchResult(item)} url={item.pic} mode={imageProxyMode} customProxy={customImageProxy} alt={item.name} />
                  <strong>{item.name}</strong>
                  <small className="ipad-search-card-meta">{[item.year, item.typeName].filter(Boolean).join(' · ') || '影视内容'}</small>
                  {item.remarks ? <small className="ipad-search-card-remarks">{item.remarks}</small> : null}
                  <span className="ipad-search-card-source">{item.sourceName}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="ipad-search-filter-empty">这个资源源没有匹配结果。选择“全部来源”查看其他结果。</div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export default function IpadEditionSearchPage() {
  return <Suspense fallback={<div className="ipad-edition__rail-message">正在打开搜索…</div>}><IpadSearchContent /></Suspense>;
}
