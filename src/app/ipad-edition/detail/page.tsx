'use client';

import { Suspense } from 'react';
import './detail.css';
import { MovieDetailPage } from '@/components/movie-detail-page';

export default function IpadEditionDetailPage() {
  return <div data-ipad-detail="true"><Suspense fallback={<main className="ipad-edition__rail-message">正在加载影片详情…</main>}><MovieDetailPage watchPath="/ipad-edition/watch" /></Suspense></div>;
}
