'use client';

import { Suspense } from 'react';
import WatchPage from '@/app/watch/page';
import { PlaybackEditionProvider } from '@/components/watch/PlaybackEditionContext';

export default function IpadEditionWatchPage() {
  return <PlaybackEditionProvider edition="cinema-v4"><Suspense fallback={<div className="ipad-edition__rail-message">正在准备播放器…</div>}><WatchPage /></Suspense></PlaybackEditionProvider>;
}
