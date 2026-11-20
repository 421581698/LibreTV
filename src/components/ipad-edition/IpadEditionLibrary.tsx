'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, removeFavorite } from '@/lib/db';
import { PosterRenderer } from '@/components/ipad-edition/PosterRenderer';
import { useAppStore } from '@/lib/store';
import { fromCmsArtwork } from '@/lib/poster';

export function IpadEditionLibrary() {
  const favorites = useLiveQuery(() => db.favorites.orderBy('addedAt').reverse().toArray(), []);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  return (
    <div className="ipad-edition__page">
      <header className="ipad-edition__page-heading"><p className="ipad-edition__eyebrow">YOUR COLLECTION</p><h1>我的资料库</h1><p>收藏的影片保存在当前设备的本地资料库中。</p></header>
      {!favorites ? <div className="ipad-edition__rail-message">正在读取本地收藏…</div> : favorites.length === 0 ? <div className="ipad-edition__rail-message">这里还空空的。打开影片详情，收藏喜欢的作品，它们就会出现在这里。</div> : (
        <div className="ipad-edition__collection-grid">
          {favorites.map((item) => {
            const params = new URLSearchParams({ source: item.sourceKey, id: item.vodId, title: item.title, sourceName: item.sourceName });
            if (item.pic) params.set('pic', item.pic);
            if (item.sourceUrl) params.set('sourceUrl', item.sourceUrl);
            return <article className="ipad-edition__library-card" key={item.id}>
              <Link className="ipad-edition__poster-card" href={'/ipad-edition/detail?' + params.toString()}>
                <PosterRenderer variant="poster" frameClassName="ipad-edition__poster-art" asset={fromCmsArtwork({ sourceKey: item.sourceKey, vodId: item.vodId, title: item.title, imageUrl: item.pic })} url={item.pic} mode={imageProxyMode} customProxy={customImageProxy} alt={item.title} />
                <strong>{item.title}</strong><small>{[item.year, item.typeName, item.sourceName].filter(Boolean).join(' · ')}</small>
              </Link>
              <button type="button" onClick={() => void removeFavorite(item.sourceKey, item.vodId)}>移出收藏</button>
            </article>;
          })}
        </div>
      )}
    </div>
  );
}
