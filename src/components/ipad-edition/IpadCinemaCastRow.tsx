'use client';

import { SmartImage } from '@/components/smart-image';

export type IpadCinemaCastMember = {
  id: number;
  name: string;
  role?: string;
  imageUrl?: string;
};

export function IpadCinemaCastRow({
  actors,
  imageMode,
  customImageProxy,
  onSelect,
}: {
  actors: IpadCinemaCastMember[];
  imageMode: 'direct' | 'proxy' | 'custom';
  customImageProxy?: string;
  onSelect?: (personId: number) => void;
}) {
  if (!actors.length) return null;

  return (
    <section className="ipad-cinema-cast ipad-cinema-section" aria-label="演员阵容">
      <h2>演员阵容</h2>
      <div className="ipad-cinema-cast__rail" role="list">
        {actors.map((actor) => {
          const content = (
            <>
              <SmartImage url={actor.imageUrl || '/placeholder.svg'} mode={imageMode} customProxy={customImageProxy} alt={actor.name} loading="lazy" />
              <strong title={actor.name}>{actor.name}</strong>
              {actor.role ? <span title={actor.role}>{actor.role}</span> : null}
            </>
          );
          return onSelect ? (
            <button key={actor.id} type="button" className="ipad-cinema-cast__item" role="listitem" onClick={() => onSelect(actor.id)}>
              {content}
            </button>
          ) : (
            <div key={actor.id} className="ipad-cinema-cast__item" role="listitem">{content}</div>
          );
        })}
      </div>
    </section>
  );
}
