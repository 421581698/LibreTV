'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import './detail.css';
import { MovieDetailPage } from '@/components/movie-detail-page';
import { TmdbMovieDetailPage } from '@/components/ipad-edition/tmdb-movie-detail-page';
import { BangumiSubjectDetailPage } from '@/components/ipad-edition/BangumiSubjectDetailPage';

function DetailContent() {
  const params = useSearchParams();
  const tmdbId = params.get('tmdbId');
  const bangumiId = params.get('bangumiId');
  const tmdbType = params.get('tmdbType') === 'tv' ? 'tv' : 'movie';
  if (bangumiId && /^\d{1,12}$/.test(bangumiId)) {
    return <div data-ipad-detail="true"><BangumiSubjectDetailPage
      id={bangumiId}
      titleFallback={params.get('title') || '未知新番'}
      posterFallback={params.get('pic') || ''}
    /></div>;
  }
  if (tmdbId && /^\d{1,12}$/.test(tmdbId)) {
    return <div data-ipad-detail="true"><TmdbMovieDetailPage
      id={tmdbId}
      type={tmdbType}
      titleFallback={params.get('title') || '未知影片'}
      posterFallback={params.get('pic') || ''}
      backdropFallback={params.get('backdrop') || ''}
      ratingFallback={params.get('rating') || ''}
    /></div>;
  }
  return <div data-ipad-detail="true"><MovieDetailPage watchPath="/ipad-edition/watch" /></div>;
}

export default function IpadEditionDetailPage() {
  return <Suspense fallback={<main className="ipad-edition__rail-message">正在加载影片详情…</main>}><DetailContent /></Suspense>;
}
