'use client';

import { Suspense } from 'react';

import { useSearchParams } from 'next/navigation';

import { V4HomepageHeader } from '@/components/home/V4HomepageHeader';
import { V4HomepageHero } from '@/components/home/V4HomepageHero';
import { V4HomepageContent } from '@/components/home/V4HomepageContent';
import { useHomeSearchController } from '@/components/home/useHomeSearchController';
import { SearchResultsView } from '@/components/search/SearchResultsView';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { DoubanItem } from '@/lib/types';
import { useToast } from '@/components/toast';
import { useSelectedSources } from '@/hooks/search/useSelectedSources';
import { useSearchDetailNav } from '@/hooks/search/useSearchDetailNav';

export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();

  const routeQuery = searchParams.get('q') ?? searchParams.get('s') ?? '';
  const yellowFilter = useAppStore((s) => s.yellowFilter);

  const { toast } = useToast();
  const selectedSources = useSelectedSources();
  const { openDetail } = useSearchDetailNav();

  const { activeQuery: urlQuery } = useHomeSearchController(routeQuery, toast);

  const handleHomepagePick = async (movie: DoubanItem) => {
    if (selectedSources.length === 0) {
      toast('请先在设置中启用至少一个可用点播源。', 'warning');
      return;
    }
    try {
      const response = await api.search(movie.title, selectedSources, yellowFilter);
      const normalize = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase();
      const target = normalize(movie.title);
      const match = response.list.find((entry) => normalize(entry.name) === target);
      if (!match) {
        toast('暂未在已启用的点播源中找到《' + movie.title + '》的准确资源。', 'warning');
        return;
      }
      openDetail(match, { rating: movie.rating, poster: movie.cover });
    } catch (error) {
      toast(error instanceof Error ? error.message : '获取影片详情失败，请稍后重试。', 'error');
    }
  };

  return (
    <div className="v4-home min-h-screen flex flex-col">
      <V4HomepageHeader overlay={!urlQuery} />
      <main className={urlQuery ? 'v4-home-main' : 'v4-home-main v4-home-main--cinema'}>
        {urlQuery ? (
          <SearchResultsView query={urlQuery} openDetail={openDetail} />
        ) : (
          <>
            <V4HomepageHero onPick={handleHomepagePick} />
            <V4HomepageContent onPick={handleHomepagePick} />
          </>
        )}
      </main>
    </div>
  );
}
