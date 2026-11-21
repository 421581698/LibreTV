'use client';

import { Suspense } from 'react';
import { IpadEditionWatchPlayer } from '@/components/ipad-edition/IpadEditionWatchPlayer';

export default function IpadEditionWatchPage() {
  return (
    <Suspense fallback={<div className="ipad-edition__rail-message">正在准备 iPad 播放器…</div>}>
      <IpadEditionWatchPlayer />
    </Suspense>
  );
}
