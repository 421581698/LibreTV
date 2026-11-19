'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { db } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { buildWatchUrl } from '@/lib/utils';
import { fromCmsArtwork } from '@/lib/poster';

export function IpadEditionContinueWatching() {
  const history = useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(8).toArray(), []);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  if (!history?.length) return null;

  return (
    <section className="ipad-edition__rail-section" aria-labelledby="ipad-continue-title">
      <div className="ipad-edition__section-heading">
        <div><p className="ipad-edition__eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2 id="ipad-continue-title">继续观看</h2></div>
        <Link href="/ipad-edition/library">我的资料库 <span aria-hidden="true">›</span></Link>
      </div>
      <div className="ipad-edition__continue-grid">
        {history.map((item) => {
          const href = buildWatchUrl({
            sourceKey: item.sourceKey,
            vodId: item.vodId,
            index: item.episodeIndex,
            title: item.title,
            sourceUrl: item.sourceUrl,
          }).replace('/watch?', '/ipad-edition/watch?');
          const progress = item.duration > 0 ? Math.min(100, Math.max(0, item.playbackPosition / item.duration * 100)) : 0;
          return <Link href={href} className="ipad-edition__continue-card" key={item.id}>
            <PosterRenderer variant="continue" frameClassName="ipad-edition__continue-art" asset={fromCmsArtwork({ sourceKey: item.sourceKey, vodId: item.vodId, title: item.title, imageUrl: item.pic })} url={item.pic} mode={imageProxyMode} customProxy={customImageProxy} alt={item.title}>
              <span className="ipad-edition__continue-play" aria-hidden="true">▶</span>
              <span className="ipad-edition__continue-progress"><i style={{ width: progress + '%' }} /></span>
            </PosterRenderer>
            <strong title={item.title}>{item.title}</strong>
            <small>{item.totalEpisodes > 1 ? '上次看到第 ' + (item.episodeIndex + 1) + ' 集' : '继续播放'}</small>
          </Link>;
        })}
      </div>
    </section>
  );
}
