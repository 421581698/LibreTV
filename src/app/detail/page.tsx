'use client';

import { Suspense } from 'react';
import '../ipad-edition/detail/detail.css';
import { MovieDetailPage } from '@/components/movie-detail-page';

export default function DetailRoute() {
  return (
    <div className="ipad-edition">
      <div data-ipad-detail="true">
        <Suspense fallback={<main className="min-h-screen bg-[#08080A]" />}>
          <MovieDetailPage watchPath="/ipad-edition/watch" />
        </Suspense>
      </div>
    </div>
  );
}
