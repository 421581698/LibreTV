'use client';

import { Suspense } from 'react';

import { useSearchParams } from 'next/navigation';

import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';
import { SearchResultsView } from '@/components/search/SearchResultsView';
import { EmptyState } from '@/components/states';
import { useSearchDetailNav } from '@/hooks/search/useSearchDetailNav';

/**
 * 独立的搜索结果路由。
 *
 * 此前实现为 `return <HomePage />`，导致结果页完全寄生在首页容器里：
 * 首页改动会直接影响结果页，结果页也无法拥有自己的布局与后续的
 * 热门搜索 / 推荐横滑 / 分类 Tab 等 V2 区块。
 *
 * 现在改为：自有页面容器（Header + main）+ 复用的 SearchResultsView。
 * 数据管线（多源并发、流式进度、跨源聚合、60 条分页）保持不变。
 */
export default function SearchResultsPage() {
  return (
    <Suspense>
      <SearchResultsContent />
    </Suspense>
  );
}

function SearchResultsContent() {
  const searchParams = useSearchParams();
  const query = (searchParams.get('q') ?? searchParams.get('s') ?? '').trim();

  // Friday 详情桥在页面层挂载一次，避免与下层组件重复监听
  const { openDetail } = useSearchDetailNav();

  return (
    <div className="v4-home min-h-screen flex flex-col">
      <V4HomepageHeader />
      <main className="v4-home-main">
        {query ? (
          <SearchResultsView query={query} openDetail={openDetail} />
        ) : (
          <EmptyState
            icon="search"
            title="请输入搜索关键词"
            description="在搜索页输入片名、演员或关键词后即可查看结果。"
            className="!py-16"
          />
        )}
      </main>
    </div>
  );
}
