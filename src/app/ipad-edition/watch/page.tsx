'use client';

import { Suspense } from 'react';
import WatchPage from '@/app/watch/page';

export default function IpadEditionWatchPage() {
  return <Suspense fallback={<div className="ipad-edition__rail-message">正在准备播放器…</div>}><WatchPage /></Suspense>;
}
