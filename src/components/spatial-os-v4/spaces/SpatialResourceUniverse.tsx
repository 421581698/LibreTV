'use client';

import { useCallback, useEffect, useState } from 'react';
import { FavoriteButton } from '@/components/favorites/FavoriteButton';
import { listFavorites, readSpatialState, writeSpatialState, type FavoriteEntry } from '@/lib/db';
import { FMHY_CATEGORIES, type FmhyCategoryId, type FmhyResource } from '@/lib/fmhy-index';

type ApiResponse = {
  categories?: typeof FMHY_CATEGORIES;
  results?: FmhyResource[];
  resource?: FmhyResource;
  error?: string;
  total?: number;
  offset?: number;
  hasMore?: boolean;
};

export function SpatialResourceUniverse() {
  const [activeCategory, setActiveCategory] = useState<FmhyCategoryId | 'all' | 'favorites'>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FmhyResource[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<FmhyResource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [favoriteRows, setFavoriteRows] = useState<FavoriteEntry[]>([]);

  const refreshFavorites = useCallback(async () => {
    try {
      setFavoriteRows(await listFavorites('fmhy-resource'));
    } catch {
      setFavoriteRows([]);
    }
  }, []);

  useEffect(() => {
    void refreshFavorites();
    const refresh = () => void refreshFavorites();
    window.addEventListener('libretv:favorites-changed', refresh);
    return () => window.removeEventListener('libretv:favorites-changed', refresh);
  }, [refreshFavorites]);

  const loadResources = useCallback(async (category: FmhyCategoryId | 'all', search: string, offset = 0, append = false) => {
    if (category === 'all' && search.trim().length < 2) {
      setResults([]);
      setTotal(0);
      setHasMore(false);
      setError(search.trim() ? '至少输入两个字符再搜索' : '');
      return;
    }
    setLoading(true);
    setError('');
    void writeSpatialState('resource-universe', { category, query: search.trim() }).catch(() => {});
    setSelected(null);
    try {
      const params = new URLSearchParams();
      if (category !== 'all') params.set('category', category);
      if (search.trim()) params.set('q', search.trim());
      if (offset > 0) params.set('offset', String(offset));
      const response = await fetch('/api/fmhy?' + params.toString());
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error || 'FMHY 目录加载失败');
      setResults((current) => append ? [...current, ...(data.results ?? [])] : (data.results ?? []));
      setTotal(data.total ?? data.results?.length ?? 0);
      setHasMore(data.hasMore ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FMHY 目录加载失败');
      setResults([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const saved = await readSpatialState<{ category?: string; query?: string }>('resource-universe');
        if (!active || !saved) return;
        const savedQuery = typeof saved.query === 'string' ? saved.query.slice(0, 100) : '';
        setQuery(savedQuery);
        if (saved.category === 'favorites') {
          setActiveCategory('favorites');
          await refreshFavorites();
          return;
        }
        const savedCategory = saved.category === 'all' || FMHY_CATEGORIES.some((item) => item.id === saved.category)
          ? saved.category as FmhyCategoryId | 'all'
          : 'all';
        setActiveCategory(savedCategory);
        if (savedCategory !== 'all' || savedQuery.length >= 2) {
          await loadResources(savedCategory, savedQuery);
        }
      } catch {
        // Keep the default workspace when IndexedDB is unavailable.
      }
    };
    void restore();
    return () => { active = false; };
  }, [loadResources, refreshFavorites]);

  const selectCategory = (category: FmhyCategoryId | 'all' | 'favorites') => {
    setActiveCategory(category);
    setSelected(null);
    if (category === 'favorites') {
      void writeSpatialState('resource-universe', { category, query: query.trim() }).catch(() => {});
      void refreshFavorites();
      setResults([]);
      setTotal(favoriteRows.length);
      setHasMore(false);
      setError('');
      return;
    }
    void loadResources(category, query);
  };

  const search = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeCategory === 'favorites') setActiveCategory('all');
    void loadResources(activeCategory === 'favorites' ? 'all' : activeCategory, query);
  };

  const loadMore = () => {
    if (loading || !hasMore || activeCategory === 'favorites') return;
    void loadResources(activeCategory, query, results.length, true);
  };

  const favoriteResource = (resource: FmhyResource) => ({
    id: 'fmhy-resource:' + resource.href,
    kind: 'fmhy-resource' as const,
    title: resource.title,
    href: resource.href,
    category: resource.categoryTitle,
    description: resource.description,
    metadata: { domain: resource.domain, sourceUrl: resource.sourceUrl },
  });

  const favoriteItems = favoriteRows.map((item) => ({
    id: item.id,
    title: item.title,
    href: item.href ?? '',
    domain: item.href ? new URL(item.href).hostname : '',
    categoryId: 'misc' as FmhyCategoryId,
    categoryTitle: item.category ?? '收藏资源',
    description: item.description ?? '',
    starred: false,
    sourceUrl: 'https://github.com/fmhy/edit',
  }));

  const visibleItems = activeCategory === 'favorites' ? favoriteItems : results;

  return (
    <section className="spatial-v4-space-content" aria-labelledby="spatial-resources-title">
      <div className="spatial-v4-space-heading">
        <p className="spatial-v4-space-eyebrow">RESOURCE UNIVERSE · FMHY</p>
        <h1 id="spatial-resources-title">资源宇宙</h1>
        <p>搜索并浏览 FMHY 官方维护的 13 类资源。目录内容从上游公开 Markdown 数据读取，收藏保存在 LibreTV 本机 IndexedDB。</p>
      </div>

      <form className="spatial-v4-fmhy-search" onSubmit={search}>
        <input
          aria-label="搜索 FMHY 资源"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索工具、网站、软件或关键词…"
          maxLength={100}
        />
        <button type="submit" disabled={loading}>{loading ? '搜索中…' : '搜索资源'}</button>
      </form>

      <div className="spatial-v4-fmhy-categories" aria-label="FMHY 分类">
        <button type="button" data-active={activeCategory === 'all'} onClick={() => selectCategory('all')}>全站搜索</button>
        {FMHY_CATEGORIES.map((category) => (
          <button
            type="button"
            key={category.id}
            data-active={activeCategory === category.id}
            onClick={() => selectCategory(category.id)}
          >
            {category.title}
          </button>
        ))}
        <button type="button" data-active={activeCategory === 'favorites'} onClick={() => selectCategory('favorites')}>
          我的资源收藏（{favoriteRows.length}）
        </button>
      </div>

      {error ? <p className="spatial-v4-fmhy-message" role="alert">{error}</p> : null}
      {loading ? <p className="spatial-v4-fmhy-message" aria-live="polite">正在读取 FMHY 官方目录…</p> : null}
      {!loading && visibleItems.length === 0 && !error ? (
        <p className="spatial-v4-fmhy-message">
          {activeCategory === 'favorites' ? '还没有收藏 FMHY 资源。' : activeCategory === 'all' ? '输入关键词搜索全站，或选择一个分类浏览。' : '该分类暂无可解析条目。'}
        </p>
      ) : null}

      {visibleItems.length > 0 ? <p className="spatial-v4-fmhy-count">显示 {visibleItems.length} / {activeCategory === 'favorites' ? favoriteRows.length : total} 项</p> : null}
      <div className="spatial-v4-resource-grid">
        {visibleItems.map((resource) => (
          <article className="spatial-v4-resource-card" key={resource.id}>
            <button type="button" className="spatial-v4-resource-open-card" onClick={() => setSelected(resource)}>
              <span className="spatial-v4-resource-title">{resource.title}</span>
              <span className="spatial-v4-resource-source">{resource.domain}</span>
              {resource.starred ? <span className="spatial-v4-resource-star">★ FMHY 推荐</span> : null}
            </button>
            <FavoriteButton
              entry={favoriteResource(resource)}
              className="spatial-v4-favorite-button absolute right-3 top-3 z-10"
            />
          </article>
        ))}
      </div>

      {hasMore && activeCategory !== 'favorites' ? (
        <div className="spatial-v4-load-more">
          <button type="button" className="spatial-v4-action-button" onClick={loadMore} disabled={loading}>
            {loading ? '正在加载…' : '加载更多资源'}
          </button>
        </div>
      ) : null}

      {selected ? (
        <div className="spatial-v4-resource-detail" role="region" aria-labelledby="spatial-resource-detail-title">
          <div className="spatial-v4-resource-detail-head">
            <div>
              <p className="spatial-v4-space-eyebrow">{selected.categoryTitle}</p>
              <h2 id="spatial-resource-detail-title">{selected.title}</h2>
            </div>
            <button type="button" className="spatial-v4-action-button" onClick={() => setSelected(null)}>关闭详情</button>
          </div>
          <p>{selected.description || 'FMHY 官方目录未提供额外说明。'}</p>
          <p className="spatial-v4-resource-domain">{selected.domain}</p>
          <div className="spatial-v4-resource-detail-actions">
            <FavoriteButton entry={favoriteResource(selected)} label="收藏资源" />
            <a className="spatial-v4-action-button" href={selected.href} target="_blank" rel="noopener noreferrer">打开官方网站 ↗</a>
            <a className="spatial-v4-source-link" href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">查看 FMHY 原始条目</a>
          </div>
        </div>
      ) : null}

      <p className="spatial-v4-source-note">
        上游：<a href="https://github.com/fmhy/edit" target="_blank" rel="noopener noreferrer">FMHY 官方目录仓库</a>。条目与分类会随上游更新；本地收藏不会写回 FMHY。
      </p>
    </section>
  );
}
